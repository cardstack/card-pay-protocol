import { readJSONSync } from "fs-extra";
import { existsSync } from "fs";
import { resolve } from "path";
import TrezorWalletProvider from "trezor-cli-wallet-provider";
import { debug as debugFactory } from "debug";
import { hashBytecodeWithoutMetadata } from "@openzeppelin/upgrades-core";

export { patchNetworks } from "./patchNetworks";

const debug = debugFactory("card-protocol.deploy");

import hre from "hardhat";
const {
  upgrades: {
    deployProxy,
    upgradeProxy,
    erc1967: { getImplementationAddress },
  },
  ethers,
  config: {
    networks: {
      hardhat: { accounts },
    },
  },
} = hre;

import {
  HardhatNetworkHDAccountsConfig,
  HttpNetworkConfig,
} from "hardhat/types";

const { mnemonic } = accounts as HardhatNetworkHDAccountsConfig;

import { Contract, ContractFactory } from "ethers";
import { JsonRpcProvider, JsonRpcSigner } from "@ethersproject/providers";
import { AddressFile } from "./config-utils";

export function readAddressFile(network: string): AddressFile {
  network = network === "hardhat" ? "localhost" : network;
  const addressesFile = resolve(
    __dirname,
    "..",
    "..",
    ".openzeppelin",
    `addresses-${network}.json`
  );
  if (!existsSync(addressesFile)) {
    throw new Error(`Cannot read from the addresses file ${addressesFile}`);
  }
  return readJSONSync(addressesFile);
}

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
    getProvider().getSigner(await getDeployAddress())
  );
}

export function getSigner(): JsonRpcSigner {
  return getProvider().getSigner();
}

export function getProvider(): JsonRpcProvider {
  const {
    network: { name: network, config },
  } = hre;

  const { chainId, url: rpcUrl } = config as HttpNetworkConfig;
  const { derivationPath } = config as unknown as { derivationPath: string };

  if (network === "localhost") {
    return ethers.getDefaultProvider(
      "http://localhost:8545"
    ) as JsonRpcProvider;
  }

  const walletProvider = new TrezorWalletProvider(rpcUrl, {
    chainId: chainId,
    numberOfAccounts: 3,
    derivationPath,
  });

  return new ethers.providers.Web3Provider(walletProvider, network);
}

export async function getDeployAddress(): Promise<string> {
  if (hre.network.name === "hardhat") {
    let [signer] = await ethers.getSigners();
    return signer.address;
  } else if (hre.network.name === "localhost") {
    if (process.env.HARDHAT_FORKING) {
      const addressesFile = `./.openzeppelin/addresses-${process.env.HARDHAT_FORKING}.json`;
      debug(
        "Determining deploy address for forked deploy from addresses file",
        addressesFile
      );

      let addresses = readJSONSync(addressesFile);
      let versionManagerAddress = addresses.VersionManager.proxy;
      let versionManager = await ethers.getContractAt(
        "VersionManager",
        versionManagerAddress
      );

      let owner = await versionManager.owner();
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [owner],
      });
      return owner;
    } else {
      return getHardhatTestWallet().address;
    }
  }
  const trezorSigner = getSigner();
  return await trezorSigner.getAddress();
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
  maxAttempts = 5
): Promise<T> {
  let attempts = 0;
  do {
    try {
      attempts++;
      return await cb();
    } catch (e) {
      debug(
        `received ${e.message}, trying again (${attempts} of ${maxAttempts} attempts)`
      );
    }
  } while (attempts < maxAttempts);

  throw new Error("Reached max retry attempts");
}

async function deployedCodeMatches(contractName: string, proxyAddress: string) {
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

export async function upgradeImplementation(
  contractName: string,
  proxyAddress: string
): Promise<void> {
  await retry(async () => {
    if (await deployedCodeMatches(contractName, proxyAddress)) {
      debug(
        `Deployed bytecode already matches for ${contractName}@${proxyAddress} - no need to deploy new version`
      );
    } else {
      debug(
        `Bytecode changed for ${contractName}@${proxyAddress}... Upgrading`
      );

      if (!process.env.DRY_RUN) {
        let factory = await makeFactory(contractName);

        await upgradeProxy(proxyAddress, factory);

        debug(`Successfully upgraded proxy`);

        let matchesAfter = await deployedCodeMatches(
          contractName,
          proxyAddress
        );

        if (!matchesAfter) {
          throw new Error(
            `Bytecode does not match for ${contractName}@${proxyAddress} after deploy!`
          );
        }
      }
    }
  });
}

export async function deployNewProxyAndImplementation(
  contractName: string,
  constructorArgs: unknown[]
): Promise<Contract> {
  return await retry(async () => {
    try {
      debug(`Creating factory`);
      let factory = await makeFactory(contractName);
      debug(`Deploying proxy`);
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
