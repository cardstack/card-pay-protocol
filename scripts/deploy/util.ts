import { readJSONSync } from "fs-extra";
import { existsSync } from "fs";
import { resolve } from "path";
import TrezorWalletProvider from "trezor-cli-wallet-provider";

import hre from "hardhat";
const {
  upgrades: {
    deployProxy,
    upgradeProxy,
    erc1967: { getImplementationAddress },
  },
  ethers,
  config: {
    networks,
    networks: {
      hardhat: { accounts },
    },
  },
} = hre;

import {
  HardhatNetworkHDAccountsConfig,
  HttpNetworkConfig,
  NetworkConfig,
} from "hardhat/types";

const { mnemonic } = accounts as HardhatNetworkHDAccountsConfig;

import { Network, Networkish } from "@ethersproject/networks";
import { Contract, ContractFactory } from "ethers";
import { JsonRpcProvider, JsonRpcSigner } from "@ethersproject/providers";
import { AddressFile } from "./config-utils";
type GetNetwork = (network: Networkish) => Network;

export function patchNetworks(): void {
  let oldGetNetwork = networks.getNetwork as unknown as GetNetwork;

  networks.getNetwork = function (network: Networkish): Network {
    if (network === "sokol" || network === 77) {
      return { name: "sokol", chainId: 77 };
    } else {
      return oldGetNetwork(network);
    }
  } as unknown as NetworkConfig;
}

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
  const derivationPath = config as unknown as { derivationPath: string };

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
      console.log(
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
      console.log(
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

  return (
    deployedCode &&
    deployedCode != "0x" &&
    deployedCode === artifact.deployedBytecode
  );
}

export async function upgradeImplementation(
  contractName: string,
  proxyAddress: string
): Promise<void> {
  await retry(async () => {
    if (await deployedCodeMatches(contractName, proxyAddress)) {
      console.log(
        `Deployed bytecode already matches for ${contractName}@${proxyAddress} - no need to deploy new version`
      );
    } else {
      console.log(
        `Bytecode changed for ${contractName}@${proxyAddress}... Upgrading`
      );

      let factory = await makeFactory(contractName);
      await upgradeProxy(proxyAddress, factory);
    }
  });
}

export async function deployNewProxyAndImplementation(
  contractName: string,
  constructorArgs: unknown[]
): Promise<Contract> {
  return await retry(async () => {
    try {
      console.log(`Creating factory`);
      let factory = await makeFactory(contractName);
      console.log(`Deploying proxy`);
      let instance = await deployProxy(factory, constructorArgs);
      console.log("Waiting for transaction");
      await instance.deployed();
      return instance;
    } catch (e) {
      console.log(e);
      throw new Error("It failed, retrying");
    }
  });
}
