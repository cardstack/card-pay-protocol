import { JsonRpcProvider, JsonRpcSigner } from "@ethersproject/providers";

import { hashBytecodeWithoutMetadata } from "@openzeppelin/upgrades-core";
import Table from "cli-table3";
import { debug as debugFactory } from "debug";
import { prompt } from "enquirer";
import { Contract, ContractFactory } from "ethers";
import { existsSync } from "fs";
import { readJSONSync, writeJsonSync } from "fs-extra";
import hre from "hardhat";
import {
  HardhatNetworkHDAccountsConfig,
  HttpNetworkConfig,
} from "hardhat/types";
import { resolve } from "path";
import TrezorWalletProvider from "trezor-cli-wallet-provider";
import { ZERO_ADDRESS } from "../../test/migration/util";
import { AddressFile, getNetwork } from "./config-utils";
import { default as contractInitSpec } from "./contract-init-spec";
import { patchNetworks } from "./patchNetworks";

export { patchNetworks };
export { contractInitSpec };
export { getNetwork };
patchNetworks();

const debug = debugFactory("card-protocol.deploy");

const {
  upgrades: {
    deployProxy,
    erc1967: { getImplementationAddress },
  },
  ethers,
  config: {
    networks: {
      hardhat: { accounts },
    },
  },
} = hre;

const { mnemonic } = accounts as HardhatNetworkHDAccountsConfig;

function getHardhatTestWallet() {
  let provider = ethers.getDefaultProvider("http://localhost:8545");
  // This is the default hardhat test mnemonic
  let wallet = ethers.Wallet.fromMnemonic(
    mnemonic || "test test test test test test test test test test test junk"
  );
  return wallet.connect(provider);
}

export async function makeFactory(
  contractName: string
): Promise<ContractFactory> {
  if (hre.network.name === "hardhat") {
    return await ethers.getContractFactory(contractName);
  } else if (hre.network.name === "localhost" && !process.env.HARDHAT_FORKING) {
    return (await ethers.getContractFactory(contractName)).connect(
      getHardhatTestWallet()
    );
  }

  return (await ethers.getContractFactory(contractName)).connect(
    getSigner(await getDeployAddress())
  );
}

export function getSigner(address?: string): JsonRpcSigner {
  return getProvider().getSigner(address);
}

let trezorProvider: JsonRpcProvider;
export function getProvider(): JsonRpcProvider {
  if (trezorProvider) {
    return trezorProvider;
  }

  const {
    network: { name: network, config },
  } = hre;

  const { chainId, url: rpcUrl } = config as HttpNetworkConfig;
  const { derivationPath } = config as unknown as { derivationPath: string };

  if (network === "localhost") {
    debug("Using ethers.getDefaultProvider");
    return ethers.getDefaultProvider(
      "http://localhost:8545"
    ) as JsonRpcProvider;
  }

  debug("Using TrezorWalletProvider");
  const walletProvider = new TrezorWalletProvider(rpcUrl, {
    chainId: chainId,
    numberOfAccounts: 3,
    derivationPath,
  });
  trezorProvider = new ethers.providers.Web3Provider(walletProvider, network);
  return trezorProvider;
}

let deployAddress: string;
export async function getDeployAddress(): Promise<string> {
  if (deployAddress) {
    return deployAddress;
  }
  if (hre.network.name === "hardhat") {
    let [signer] = await ethers.getSigners();
    deployAddress = signer.address;
  } else if (hre.network.name === "localhost") {
    if (process.env.HARDHAT_FORKING) {
      debug("Determining deploy address for forked deploy from metadata file");

      let upgradeManagerAddress = readMetadata(
        "upgradeManagerAddress",
        process.env.HARDHAT_FORKING
      );
      debug("Found upgrade manager address in metadata", upgradeManagerAddress);
      let upgradeManager = await ethers.getContractAt(
        "UpgradeManager",
        upgradeManagerAddress
      );

      let owner = await upgradeManager.owner();

      debug(`Impersonating upgradeManager owner: ${owner}`);

      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [owner],
      });
      deployAddress = owner;
    } else {
      deployAddress = getHardhatTestWallet().address;
    }
  } else {
    const trezorSigner = getSigner();
    deployAddress = await trezorSigner.getAddress();
  }
  return deployAddress;
}

export function asyncMain(main: { (...args: unknown[]): Promise<void> }): void {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

type RetryCallback<T> = () => Promise<T>;

export async function retry<T>(
  cb: RetryCallback<T>,
  maxAttempts = 10
): Promise<T> {
  let attempts = 0;
  do {
    await delay(1000 + attempts * 1000);
    try {
      attempts++;
      return await cb();
    } catch (e) {
      debug(
        `received ${e.message}, trying again (${attempts} of ${maxAttempts} attempts)`
      );

      if (e.stack) {
        debug(e.stack);
      }
    }
  } while (attempts < maxAttempts);

  throw new Error("Reached max retry attempts");
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deployedCodeMatches(
  contractName: string,
  proxyAddress: string
): Promise<boolean> {
  let currentImplementationAddress = await getImplementationAddress(
    proxyAddress
  );
  debug(
    `Checking implementation of ${contractName}@${proxyAddress} (curent implementation: ${currentImplementationAddress})`
  );

  return await deployedImplementationMatches(
    contractName,
    currentImplementationAddress
  );
}

export async function deployedImplementationMatches(
  contractName: string,
  implementationAddress: string
): Promise<boolean> {
  let artifact = hre.artifacts.require(contractName);

  let deployedCode = await getProvider().getCode(implementationAddress);
  if (!deployedCode || deployedCode === "0x") {
    return;
  }

  let deployedCodeHash = hashBytecodeWithoutMetadata(deployedCode);
  let localCodeHash = hashBytecodeWithoutMetadata(artifact.deployedBytecode);

  debug(
    `On chain code hash at ${implementationAddress} (without metadata): ${deployedCodeHash}`
  );

  debug(`Local bytecode hash (without metadata): ${localCodeHash}`);

  return deployedCodeHash === localCodeHash;
}

export async function deployNewProxyAndImplementation(
  contractName: string,
  constructorArgs: unknown[]
): Promise<Contract> {
  return await retry(async () => {
    try {
      debug(`Creating factory`);
      let factory = await makeFactory(contractName);
      debug(`Deploying proxy with constructorArgs`, constructorArgs);
      let instance = await deployProxy(factory, constructorArgs);
      debug("Waiting for transaction");
      await instance.deployed();
      return instance;
    } catch (e) {
      debug(e);
      throw new Error("It failed, retrying");
    }
  });
}

export async function getProxies(network: string): Promise<string[]> {
  let upgradeManager = await getUpgradeManager(network);
  return await upgradeManager.getProxies();
}

export async function getProxyAddresses(network: string): Promise<AddressFile> {
  let proxies = await getProxies(network);
  let upgradeManager = await getUpgradeManager(network);

  let addresses: AddressFile = {};
  for (let proxyAddress of proxies) {
    let id = await upgradeManager.getAdoptedContractId(proxyAddress);
    addresses[id] = { proxy: proxyAddress };
  }

  return addresses;
}

export async function reportProtocolStatus(
  network: string,
  includeUnchanged = false
): Promise<{ table: Table.Table; anyChanged: boolean }> {
  let upgradeManager = await getUpgradeManager(network);

  let proxyAddresses = await getProxies(network);

  let contracts = contractInitSpec({ network });

  let anyChanged = false;

  let table = new Table({
    head: [
      "Contract ID",
      "Contract Name",
      "Proxy Address",
      "Current Implementation Address",
      "Proposed Implementation Address",
      "Proposed Function Call",
      "Local Bytecode Changed",
    ],
  });

  for (let proxyAddress of proxyAddresses) {
    let adoptedContract = await upgradeManager.adoptedContractsByProxyAddress(
      proxyAddress
    );
    let contractName = contracts[adoptedContract.id].contractName;
    let contract = await ethers.getContractAt(contractName, proxyAddress);

    let localBytecodeChanged = (await deployedCodeMatches(
      contractName,
      proxyAddress
    ))
      ? null
      : "YES";

    let codeChanges =
      adoptedContract.upgradeAddress !== ZERO_ADDRESS ||
      adoptedContract.encodedCall !== "0x" ||
      localBytecodeChanged;

    if (codeChanges) {
      anyChanged = true;
    }

    if (!codeChanges && !includeUnchanged) {
      continue;
    }

    table.push([
      adoptedContract.id,
      contractName,
      proxyAddress,
      await getImplementationAddress(proxyAddress),
      adoptedContract.upgradeAddress !== ZERO_ADDRESS
        ? adoptedContract.upgradeAddress
        : null,
      adoptedContract.encodedCall !== "0x"
        ? await decodeEncodedCall(contract, adoptedContract.encodedCall)
        : null,
      localBytecodeChanged,
    ]);
  }

  return { table, anyChanged };
}

export async function decodeEncodedCall(
  contract: Contract,
  encodedCall: string
): Promise<string> {
  let tx = contract.interface.parseTransaction({ data: encodedCall });
  let {
    functionFragment: { name, inputs },
    args,
  } = tx;

  let formattedArgs = inputs.map(
    (input, i) => `\n  ${input.type} ${input.name}: ${args[i]}`
  );

  return `${name}(${formattedArgs.join()}\n)`;
}

export async function getUpgradeManager(network: string): Promise<Contract> {
  let upgradeManagerAddress = readMetadata("upgradeManagerAddress", network);
  return await ethers.getContractAt(
    "UpgradeManager",
    upgradeManagerAddress,
    getSigner(await getDeployAddress())
  );
}

export async function getOrDeployUpgradeManager(
  network: string,
  owner: string
): Promise<Contract> {
  if (readMetadata("upgradeManagerAddress", network)) {
    let upgradeManager = await getUpgradeManager(network);
    debug(`Found existing upgrade manager at ${upgradeManager.address}`);
    return upgradeManager;
  } else {
    debug(`Deploying new upgrade manager`);
    let UpgradeManager = await makeFactory("UpgradeManager");

    let upgradeManager = await deployProxy(UpgradeManager, [owner]);
    await upgradeManager.deployed();

    debug(`Deployed new upgrade manager to ${upgradeManager.address}`);
    writeMetadata("upgradeManagerAddress", upgradeManager.address, network);
    return upgradeManager;
  }
}

export function readMetadata(
  key: string,
  network: string = getNetwork()
): string {
  let path = metadataPath(network);
  if (existsSync(path)) {
    return readJSONSync(path)[key];
  }
}
export function writeMetadata(
  key: string,
  value: unknown,
  network: string = getNetwork()
): void {
  let path = metadataPath(network);
  let metadata = {};
  if (existsSync(path)) {
    metadata = readJSONSync(path);
  }

  metadata[key] = value;

  writeJsonSync(path, metadata);
}

function metadataPath(network: string) {
  return resolve(__dirname, `../../.openzeppelin/metadata-${network}.json`);
}

export async function confirm(message: string): Promise<boolean> {
  if (process.env.CARDPAY_AUTOCONFIRM == "true") {
    return true;
  }

  let { question } = (await prompt({
    type: "confirm",
    name: "question",
    message,
  })) as { question: boolean };

  return question;
}

export async function contractWithSigner(
  contract: Contract,
  signer: string
): Promise<Contract> {
  return contract.connect(getSigner(signer));
}
