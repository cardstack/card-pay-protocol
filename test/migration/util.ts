import { debug as debugFactory } from "debug";
import TrezorWalletProvider from "trezor-cli-wallet-provider";
import {
  BigNumber,
  BigNumberish,
  Contract,
  ContractFactory,
  Signer,
  utils,
} from "ethers";
import { readFileSync } from "fs";
import { artifacts, ethers, network } from "hardhat";
import { resolve } from "path";
import sokolAddresses from "../../.openzeppelin/addresses-sokol.json";
import xdaiAddresses from "../../.openzeppelin/addresses-xdai.json";

export const debug = debugFactory("card-protocol.migration");

// bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1)
export const PROXY_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

let addresses: { [x: string]: { contractName: string; proxy: string } };

switch (process.env.HARDHAT_FORKING || network.name) {
  case "sokol":
    addresses = sokolAddresses;
    break;
  case "xdai":
    addresses = xdaiAddresses;
    break;
}

// Only execute this if we want a forked contract
export function forkedDescribe(
  description: string,
  tests: (this: Mocha.Suite) => void
): void {
  if (process.env.HARDHAT_FORKING) {
    describe.only(description, tests);
  }
}

export const proxyAdminInterface = [
  "function getProxyAdmin(address proxy) public view returns (address)",
  "function getProxyImplementation(address proxy) public view returns (address)",
  "function upgrade(address proxy, address implementation) public",
  "function upgradeAndCall(address proxy, address implementation, bytes memory data) public payable",
  "function owner() public view returns (address) ",
];

export async function getDeployedContract(label: string): Promise<{
  contract: Contract;
  proxyAdmin: Contract;
  owner: string;
  oldImplementation: string;
}> {
  let name = addresses[label].contractName;
  let proxyAddress = addresses[label].proxy;

  let contract = connectContractToProvider(
    await ethers.getContractAt(name, proxyAddress)
  );

  let proxyAdminAddress =
    "0x" +
    (
      await ethers.provider.getStorageAt(contract.address, PROXY_ADMIN_SLOT)
    ).slice(26);

  debug(`Proxy admin: ${proxyAdminAddress}`);

  let proxyAdmin = connectContractToProvider(
    await ethers.getContractAt(proxyAdminInterface, proxyAdminAddress)
  );

  let owner = await proxyAdmin.owner();
  proxyAdmin = await getContractAsOwner(proxyAdmin, proxyAdminInterface, owner);

  let oldImplementation = await proxyAdmin.getProxyImplementation(
    contract.address
  );

  return {
    contract,
    proxyAdmin,
    owner,
    oldImplementation,
  };
}

export const CONTRACTS = Object.keys(addresses || {}).filter(
  // the delegate implementation is not upgradeable in the same way as other contracts
  (c) => c !== "RewardSafeDelegateImplementation"
);

export type StorageLayoutItem = {
  contract: string;
  label: string;
  slot: string;
  type: string;
  offset: number;
  astId: number;
};

export type StorageLayoutType = {
  encoding: string;
  key: string;
  label: string;
  numberOfBytes: string;
  value: string;
};

export type StorageLayout = {
  storage: Array<StorageLayoutItem>;
  types: Array<StorageLayoutType>;
};

export async function getOldStorageLayout(
  label: string
): Promise<StorageLayout> {
  let contractName = addresses[label].contractName;
  return JSON.parse(
    readFileSync(
      resolve(__dirname, `old-storage-layout/${contractName}.json`),
      "utf8"
    )
  );
}

export async function getCurrentStorageLayout(
  label: string
): Promise<StorageLayout> {
  let contract = addresses[label].contractName;

  let fullyQualifiedNames = await artifacts.getAllFullyQualifiedNames();
  let fullName = fullyQualifiedNames.find((n) => n.split(":")[1] === contract);

  const { sourceName, contractName } = await artifacts.readArtifact(fullName);

  for (const artifactPath of await artifacts.getBuildInfoPaths()) {
    const artifact: Buffer = readFileSync(artifactPath);
    const artifactJsonABI = JSON.parse(artifact.toString());
    try {
      if (!artifactJsonABI.output.contracts[sourceName][contractName]) {
        continue;
      }
    } catch (e) {
      continue;
    }

    return artifactJsonABI.output.contracts[sourceName][contractName]
      .storageLayout;
  }
}

export async function getContractFactory(
  label: string
): Promise<ContractFactory> {
  let contractName = addresses[label]?.contractName || label;
  return connectFactoryToProvider(
    await ethers.getContractFactory(contractName)
  );
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const EMPTY_SLOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export type Cache = {
  [x: string]: unknown;
  _unhandledTypes: Set<string>;
};

export async function fetch(
  cache: Cache,
  key: string,
  cb: () => Promise<unknown>
): Promise<unknown> {
  if (Object.prototype.hasOwnProperty.call(cache, key)) {
    return cache[key];
  } else {
    let result = await cb();
    cache[key] = result;
    return result;
  }
}

export async function switchToReaderImpl(
  cache: Cache,
  setReader: Contract,
  oldImplementation: string,
  contract: Contract,
  callback: (readerInstance: Contract) => Promise<unknown>
): Promise<unknown> {
  let readerCode: string = (await fetch(
    cache,
    "_readerCode",
    async () =>
      await network.provider.request({
        method: "eth_getCode",
        params: [setReader.address],
      })
  )) as string;

  let oldCode: string = (await fetch(
    cache,
    `_code.${oldImplementation}`,
    async () =>
      await network.provider.request({
        method: "eth_getCode",
        params: [contract.address],
      })
  )) as string;

  await network.provider.request({
    method: "hardhat_setCode",
    params: [contract.address, readerCode],
  });

  let readerInstance = await ethers.getContractAt(
    "EnumerableSetUpgradeUtil",
    contract.address
  );

  let result = await callback(readerInstance);

  await network.provider.request({
    method: "hardhat_setCode",
    params: [contract.address, oldCode],
  });

  return result;
}

export const KnownSlots = {
  RewardManager: {
    rewardProgramIDs: "209",
  },
  PrepaidCardMarket: {
    inventory: "156",
  },
  MerchantManager: { merchants: "206" },
  RewardPool: {
    _owner: "101",
  },
  SPEND: {
    _owner: "103",
  },
  "*": {
    _owner: "51",
  },
};
export const CHECK_VALUES = true;

export function oldLabelToNewLabel(oldLabel: string): string {
  return (
    {
      initializing: "_initializing",
      initialized: "_initialized",
    }[oldLabel] || oldLabel
  );
}

export function oldTypeToNewType(oldType: string): string {
  return (
    {
      "struct EnumerableSet.AddressSet":
        "struct EnumerableSetUpgradeable.AddressSet",
      "mapping(address => struct EnumerableSet.AddressSet)":
        "mapping(address => struct EnumerableSetUpgradeable.AddressSet)",
      "mapping(bytes32 => struct EnumerableSet.AddressSet)":
        "mapping(bytes32 => struct EnumerableSetUpgradeable.AddressSet)",
    }[oldType] || oldType
  );
}

export function isGap(
  oldStorage: StorageLayoutItem,
  newStorage: StorageLayoutItem
): boolean {
  return (
    oldStorage.label.endsWith("__gap") && newStorage.label.endsWith("__gap")
  );
}

export function bytes32(int: BigNumber): string {
  let str = int.toHexString();
  return "0x" + str.slice(2, str.length).padStart(64, "0");
}

// bytes32(uint256(keccak256("cardstack.upgraded.gnosis-1-3")) - 1)
export const UpgradeSlot = BigNumber.from(
  "0x0b1bb611f79d610ce486931d9d82ba0af2f593da3a1bbc64de519121a192be5c"
);

export const GENESIS_BLOCK = 0;

export function mapSlotForKey(key: string, slot: string): string {
  // https://medium.com/coinmonks/solidity-tutorial-all-about-mappings-29a12269ee14#:~:text=The%20variable%20balances%20is%20located%20in%20slot%202%20in%20storage.%20As%20seen%20before%2C%20we%20concatenate%20both%20the%20key%20with%20the%20slot%20number%2C%20as%20in%20the%20formula%20below%3A
  // https://archive.ph/LDh4i

  return utils.keccak256(
    `${bytes32(BigNumber.from(key))}${bytes32(BigNumber.from(slot)).slice(
      2,
      66
    )}`
  );
}

const CHUNK_SIZE = 10;

export type Upgrader =
  | string
  | ((contract: Contract, proxyAdmin: Contract) => Promise<void>);

export const UPGRADERS: {
  [key: string]: Upgrader;
} = {
  RewardManager: "RewardManagerUpgrader",
  RewardPool: "RewardPoolUpgrader",

  PrepaidCardMarket: async (contract, proxyAdmin) => {
    let upgraderFactory = connectFactoryToProvider(
      await ethers.getContractFactory("PrepaidCardMarketUpgrader")
    );

    let upgraderImplementation = await upgraderFactory.deploy();
    let events = await contract.queryFilter(
      contract.filters.ItemSet(),
      GENESIS_BLOCK
    );

    let skus: string[] = uniq(events.map((e) => e.args.sku));
    await retry(() =>
      proxyAdmin.upgrade(contract.address, upgraderImplementation.address)
    );

    let contractAsUpgrader = await getContractAsOwner(
      contract,
      "PrepaidCardMarketUpgrader",
      await contract.owner()
    );

    while (skus.length > 0) {
      let chunk = skus.splice(0, CHUNK_SIZE);
      debug(
        `Upgrading PrepaidCardMarket#inventory address set for skus ${chunk.join(
          ", "
        )}`
      );

      let gas = await contractAsUpgrader.estimateGas.upgradeChunk(chunk);
      debug(`Gas usage for PrepaidCardMarket#upgradeChunk: ${gas}`);

      await retry(() => contractAsUpgrader.upgradeChunk(chunk));
    }

    await retry(() => contractAsUpgrader.upgradeFinished());
  },
  MerchantManager: async (contract, proxyAdmin) => {
    let upgraderFactory = await getContractFactory("MerchantManagerUpgrader");

    debug("Deploying upgrader");
    let upgraderImplementation = await upgraderFactory.deploy();
    let events = await contract.queryFilter(
      contract.filters.MerchantCreation(),
      GENESIS_BLOCK
    );

    let merchants: string[] = uniq(events.map((e) => e.args.merchant));
    debug("Upgrading to upgrader");
    await retry(() =>
      proxyAdmin.upgrade(contract.address, upgraderImplementation.address)
    );

    let contractAsUpgrader = await getContractAsOwner(
      contract,
      "MerchantManagerUpgrader",
      await contract.owner()
    );

    while (merchants.length > 0) {
      let chunk = merchants.splice(0, CHUNK_SIZE);
      debug(
        `Upgrading MerchantManager#merchants address set for merchants ${chunk.join(
          ", "
        )}`
      );

      let gas = await contractAsUpgrader.estimateGas.upgradeChunk(chunk);
      debug(`Gas usage for MerchantManager#upgradeChunk: ${gas}`);
      await retry(() => contractAsUpgrader.upgradeChunk(chunk));
    }
    await retry(() => contractAsUpgrader.upgradeFinished());
  },
  TokenManager: "TokenManagerUpgrader",
  SPEND: "SPENDUpgrader",
  PrepaidCardManager: "PrepaidCardManagerUpgrader",
  RevenuePool: "RevenuePoolUpgrader",
};

export async function getContractAsOwner(
  contract: Contract,
  contractNameOrAbi: string | unknown[],
  owner: string
): Promise<Contract> {
  let contractAsNew = connectContractToProvider(
    await ethers.getContractAt(contractNameOrAbi, contract.address)
  );

  let signer: Signer;

  if (useTrezorProvider()) {
    signer = getTrezorProvider().getSigner(owner);
  } else {
    signer = await ethers.getSigner(owner);
  }

  return contractAsNew.connect(signer);
}

export async function migrateContract(
  contract: Contract,
  contractName: string,
  proxyAdmin: Contract
): Promise<{ result: unknown; newImplementation: Contract }> {
  debug("Deploying new implementation");
  let factory = await getContractFactory(contractName);
  let newImplementation = await factory.deploy();
  debug(`Deployed new implementation at ${newImplementation.address}`);

  let upgrader: Upgrader = UPGRADERS[contractName];

  if (!upgrader) {
    upgrader = "EnumerableSetUpgradeUtil";
  }
  debug(`Using ${upgrader} for ${contractName}`);

  let oldOwner = await contract.owner();

  if (typeof upgrader === "function") {
    await upgrader(contract, proxyAdmin);
  } else {
    let upgraderFactory = connectFactoryToProvider(
      await ethers.getContractFactory(upgrader)
    );
    debug(`Deploying new implementation ${upgrader}`);
    let upgraderImplementation = await upgraderFactory.deploy();

    const callData = upgraderImplementation.interface.encodeFunctionData(
      "upgrade",
      []
    );

    debug("Estimating gas");
    let gas = await proxyAdmin.estimateGas.upgradeAndCall(
      contract.address,
      upgraderImplementation.address,
      callData
    );

    debug(`Gas usage for upgrade of ${contractName}: ${gas}`);

    await proxyAdmin.upgradeAndCall(
      contract.address,
      upgraderImplementation.address,
      callData
    );
  }

  if (oldOwner !== (await contract.owner())) {
    throw new Error(
      `Owner incorrect during upgrade process for contract ${contractName}`
    );
  }

  let result = await proxyAdmin.upgrade(
    contract.address,
    newImplementation.address
  );
  return {
    result,
    newImplementation,
  };
}

// Upgraded merchant manager implementation relied on for later migrations
const exceptions = {
  MerchantManager: 1,
};

export function sortContracts(contracts: string[]): string[] {
  return contracts.sort((a, b) => {
    // https://stackoverflow.com/a/38449645
    if (exceptions[a] && exceptions[b]) {
      //if both items are exceptions
      return exceptions[a] - exceptions[b];
    } else if (exceptions[a]) {
      //only `a` is in exceptions, sort it to front
      return -1;
    } else if (exceptions[b]) {
      //only `b` is in exceptions, sort it to back
      return 1;
    } else {
      //no exceptions to account for, return alphabetic sort
      return a.localeCompare(b);
    }
  });
}

export function uniq<T>(array: Array<T>): Array<T> {
  return [...new Set(array)];
}

export type RevenueBalance = {
  tokens: string[];
  balance: { [tokenAddress: string]: BigNumberish };
};

function getTrezorProvider() {
  const { config } = network;

  let walletProvider = new TrezorWalletProvider(config["url"], {
    chainId: config["chainId"],
    numberOfAccounts: 3,
    derivationPath: config["derivationPath"],
  });

  return new ethers.providers.Web3Provider(walletProvider, network.name);
}

export function connectContractToProvider(contract: Contract): Contract {
  if (useTrezorProvider()) {
    return contract.connect(getTrezorProvider());
  } else {
    return contract;
  }
}

export function connectFactoryToProvider(
  contractFactory: ContractFactory
): ContractFactory {
  if (useTrezorProvider()) {
    return contractFactory.connect(getTrezorProvider().getSigner());
  } else {
    return contractFactory;
  }
}

function useTrezorProvider() {
  return (
    ["sokol", "xdai"].includes(network.name) && !process.env.HARDHAT_FORKING
  );
}

async function retry(cb, maxAttempts = 5): Promise<unknown> {
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
