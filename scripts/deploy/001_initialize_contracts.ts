import glob from "glob";
import difference from "lodash/difference";
import { writeJSONSync, readJSONSync, existsSync } from "fs-extra";

import hre from "hardhat";

import {
  getDeployAddress,
  patchNetworks,
  asyncMain,
  upgradeImplementation,
  deployNewProxyAndImplementation,
  deployedImplementationMatches,
  makeFactory,
  retry,
} from "./util";
import { AddressFile } from "./config-utils";

patchNetworks();

async function main() {
  let {
    network: { name: network },
  } = hre;

  console.log(`Deploying to ${network}`);
  if (process.env.HARDHAT_FORKING) {
    network = process.env.HARDHAT_FORKING;
    console.log(`(Deploying to forked copy of ${network})`);
  }

  const owner = await getDeployAddress();
  console.log(`Deploying from address ${owner}`);

  type ContractInitSpec = {
    [contractId: string]: {
      contractName: string;
      init: string[];
      nonUpgradeable?: boolean;
    };
  };

  // Contract init details. For each upgradable contract provide a property
  // name that represents the contract "ID" (this is useful when there are
  // multiple instances of the same contract that need to be deployed), where
  // the value is an object that specifies the contract's name (as specified
  // in the solidity file), and an array of the initialize parameters to use
  // when creating the upgradable contract.
  let contracts: ContractInitSpec = {
    VersionManager: {
      contractName: "VersionManager",
      init: [owner],
    },
    PrepaidCardManager: {
      contractName: "PrepaidCardManager",
      init: [owner],
    },
    PrepaidCardMarket: {
      contractName: "PrepaidCardMarket",
      init: [owner],
    },
    PrepaidCardMarketV2: {
      contractName: "PrepaidCardMarketV2",
      init: [owner],
    },
    RevenuePool: { contractName: "RevenuePool", init: [owner] },
    RewardPool: { contractName: "RewardPool", init: [owner] },
    Exchange: { contractName: "Exchange", init: [owner] },
    ActionDispatcher: {
      contractName: "ActionDispatcher",
      init: [owner],
    },
    PayMerchantHandler: {
      contractName: "PayMerchantHandler",
      init: [owner],
    },
    RegisterMerchantHandler: {
      contractName: "RegisterMerchantHandler",
      init: [owner],
    },
    SplitPrepaidCardHandler: {
      contractName: "SplitPrepaidCardHandler",
      init: [owner],
    },
    TransferPrepaidCardHandler: {
      contractName: "TransferPrepaidCardHandler",
      init: [owner],
    },
    SetPrepaidCardInventoryHandler: {
      contractName: "SetPrepaidCardInventoryHandler",
      init: [owner],
    },
    RemovePrepaidCardInventoryHandler: {
      contractName: "RemovePrepaidCardInventoryHandler",
      init: [owner],
    },
    SetPrepaidCardAskHandler: {
      contractName: "SetPrepaidCardAskHandler",
      init: [owner],
    },
    AddPrepaidCardSKUHandler: {
      contractName: "AddPrepaidCardSKUHandler",
      init: [owner],
    },
    BridgeUtils: { contractName: "BridgeUtils", init: [owner] },
    TokenManager: { contractName: "TokenManager", init: [owner] },
    MerchantManager: {
      contractName: "MerchantManager",
      init: [owner],
    },
    SupplierManager: {
      contractName: "SupplierManager",
      init: [owner],
    },
    SPEND: { contractName: "SPEND", init: [owner] },
    DAIOracle: { contractName: "ChainlinkFeedAdapter", init: [owner] },
    CARDOracle: { contractName: "DIAOracleAdapter", init: [owner] },
    RewardManager: { contractName: "RewardManager", init: [owner] },
    RewardSafeDelegateImplementation: {
      contractName: "RewardSafeDelegateImplementation",
      init: [],
      nonUpgradeable: true,
    },
    AddRewardRuleHandler: {
      contractName: "AddRewardRuleHandler",
      init: [owner],
    },
    LockRewardProgramHandler: {
      contractName: "LockRewardProgramHandler",
      init: [owner],
    },
    RegisterRewardProgramHandler: {
      contractName: "RegisterRewardProgramHandler",
      init: [owner],
    },
    RegisterRewardeeHandler: {
      contractName: "RegisterRewardeeHandler",
      init: [owner],
    },
    UpdateRewardProgramAdminHandler: {
      contractName: "UpdateRewardProgramAdminHandler",
      init: [owner],
    },
    PayRewardTokensHandler: {
      contractName: "PayRewardTokensHandler",
      init: [owner],
    },
  };

  // Use manual feeds in sokol
  if (["sokol", "hardhat", "localhost"].includes(network)) {
    contracts["DAIUSDFeed"] = {
      contractName: "ManualFeed",
      init: [owner],
    };
    contracts["ETHUSDFeed"] = {
      contractName: "ManualFeed",
      init: [owner],
    };
  }
  // only use mock DIA for private networks
  if (
    ["hardhat", "localhost"].includes(network) &&
    !process.env.HARDHAT_FORKING
  ) {
    contracts["CARDOracle"] = {
      contractName: "ChainlinkFeedAdapter",
      init: [owner],
    };
    contracts["CARDUSDFeed"] = {
      contractName: "ManualFeed",
      init: [owner],
    };
  }

  // this mechanism is put in place to ensure that typos in the above contracts data structure do not lead to unintentionally deploying the wrong contract
  const nameExceptions = [
    "DAIOracle",
    "CARDOracle",
    "DAIUSDFeed",
    "ETHUSDFeed",
    "CARDUSDFeed",
  ];

  for (let contractId of Object.keys(contracts)) {
    let contractName = contracts[contractId].contractName;
    if (contractName !== contractId && !nameExceptions.includes(contractId)) {
      throw new Error(
        `${contractId} has contract name ${contractName} - is that intentional? If so, add it to the exception list in deploy/001_initialize_contracts script.`
      );
    }
  }

  const addressesFile = `./.openzeppelin/addresses-${network}.json`;
  const addressesBackupFile = `./.openzeppelin/addresses-${network}-${Date.now()}.json.bak`;
  let skipVerify = process.env.SKIP_VERIFY === "true";
  let proxyAddresses: AddressFile = {};
  let newImpls = [];
  let reverify = [];
  let previousImpls = implAddresses(network);
  if (existsSync(addressesFile)) {
    proxyAddresses = readJSONSync(addressesFile);
  }

  for (let [
    contractId,
    { contractName, init, nonUpgradeable },
  ] of Object.entries(contracts)) {
    let proxyAddress: string;

    init = init.map((i) => {
      if (typeof i !== "string") {
        return i;
      }
      let iParts = i.split(".");
      if (iParts.length === 1) {
        return i;
      }
      let [id, prop] = iParts;
      switch (prop) {
        case "address": {
          let address = proxyAddresses[id].proxy;
          if (address == null) {
            throw new Error(
              `The address for contract ${id} has not been derived yet. Cannot initialize ${contractId} with ${i}`
            );
          }
          return address;
        }
        default:
          throw new Error(
            `Do not know how to handle property "${prop}" from ${i} when processing the init args for ${contractId}`
          );
      }
    });

    if (proxyAddresses[contractId] && !nonUpgradeable) {
      ({ proxy: proxyAddress } = proxyAddresses[contractId]);
      console.log(
        `Upgrading ${contractId} (${contractName}@${proxyAddress}) ...`
      );
      await upgradeImplementation(contractName, proxyAddress);
    } else if (nonUpgradeable) {
      // if the contract is not upgradeable, deploy a new version each time.
      // Deploying a new version each time probably only makes sense for contracts
      // that are used as delegate implementations, and it is done so that when
      // changes are made to that contract, a new one is deployed and other contracts
      // are configured to point to it later.

      // This behaviour makes sense for RewardSafeDelegateImplementation,
      // however it may not make sense for other non-upgradeable contracts in the future
      if (
        proxyAddresses[contractId] &&
        (await deployedImplementationMatches(
          contractName,
          proxyAddresses[contractId].proxy
        ))
      ) {
        console.log(
          "Deployed implementation of",
          contractName,
          "is already up to date"
        );
      } else {
        console.log(
          `Deploying new non upgradeable contract ${contractId} (${contractName})...`
        );

        if (!process.env.DRY_RUN) {
          let factory = await makeFactory(contractName);
          let instance;

          await retry(async () => {
            instance = await factory.deploy(...init);
          });
          console.log(
            `Deployed new non upgradeable contract ${contractId} (${contractName}) to ${instance.address}`
          );
          proxyAddresses[contractId] = {
            proxy: instance.address, // it's misleading to use the proxy field here, however it's the address used later to refer to the contract
            contractName,
          };
        }
      }
    } else {
      console.log(`Deploying new contract ${contractId} (${contractName})...`);

      if (!process.env.DRY_RUN) {
        let instance = await deployNewProxyAndImplementation(
          contractName,
          init
        );

        ({ address: proxyAddress } = instance);
        proxyAddresses[contractId] = {
          proxy: proxyAddress,
          contractName,
        };
        console.log(
          `Deployed new proxy for ${contractId} (contract name: ${contractName}) to address ${proxyAddress}`
        );
        writeJSONSync(addressesBackupFile, proxyAddresses);
      }
    }
    let unverifiedImpls = difference(implAddresses(network), [
      ...previousImpls,
      ...newImpls,
    ]);
    for (let impl of unverifiedImpls) {
      if (!skipVerify) {
        try {
          await hre.run("verify:verify", {
            address: impl,
            constructorArguments: [],
          });
        } catch (e) {
          console.error(e);
        }
      }
      newImpls.push(impl);
      reverify.push({ name: contractName, address: impl });
    }
  }

  writeJSONSync(addressesFile, proxyAddresses);
  console.log(`
Deployed Contracts:`);
  for (let [name, { proxy: address }] of Object.entries(proxyAddresses)) {
    console.log(`  ${name}: ${address}`);
  }

  if (reverify.length > 0) {
    console.log(`
Implementation contract verification commands:`);
    for (let { name, address } of reverify) {
      console.log(
        `npx hardhat verify --network ${network} ${address} # ${name}`
      );
    }
  }
}

function implAddresses(network: string) {
  let networkId: number;
  switch (network) {
    case "sokol":
      networkId = 77;
      break;
    case "xdai":
      networkId = 100;
      break;
    case "hardhat":
    case "localhost":
      networkId = 31337;
      break;
    default:
      throw new Error(`Do not know network ID for network ${network}`);
  }
  let [file] = glob.sync(`./.openzeppelin/*-${networkId}.json`);
  if (!file) {
    return [];
  }
  let json = readJSONSync(file);
  return Object.values(json.impls).map(
    (i) => (i as { address: string }).address
  );
}

asyncMain(main);