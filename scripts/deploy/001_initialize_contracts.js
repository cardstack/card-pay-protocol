const glob = require("glob");
const difference = require("lodash/difference");
const { writeJSONSync, readJSONSync, existsSync } = require("node-fs-extra");
const { verifyImpl } = require("../../lib/verify");
const retry = require("async-await-retry");

const hre = require("hardhat");

const {
  getDeployAddress,
  makeFactory,
  patchNetworks,
  asyncMain,
} = require("./util");

patchNetworks();

async function main() {
  const {
    upgrades: { deployProxy, upgradeProxy },
    network: { name: network },
  } = hre;

  console.log(`Deploying to ${network}`);

  const owner = await getDeployAddress();
  console.log(`Deploying from address ${owner}`);

  // Contract init details. For each upgradable contract provide a property
  // name that represents the contract "ID" (this is useful when there are
  // multiple instances of the same contract that need to be deployed), where
  // the value is an object that specifies the contract's name (as specified
  // in the solidity file), and an array of the initialize parameters to use
  // when creating the upgradable contract.
  let contracts = {
    PrepaidCardManager: {
      contractName: "PrepaidCardManager",
      init: [owner],
    },
    PrepaidCardMarket: {
      contractName: "PrepaidCardMarket",
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
    RemoveRewardRuleHandler: {
      contractName: "RemoveRewardRuleHandler",
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
  if (network === "sokol" || network == "hardhat") {
    contracts["DAIUSDFeed"] = {
      contractName: "ManualFeed",
      init: [owner],
    };
    contracts["ETHUSDFeed"] = {
      contractName: "ManualFeed",
      init: [owner],
    };
  }

  const addressesFile = `./.openzeppelin/addresses-${network}.json`;
  let skipVerify = process.env.SKIP_VERIFY === "true";
  let proxyAddresses = {};
  let newImpls = [];
  let reverify = [];
  let previousImpls = implAddresses(network);
  if (existsSync(addressesFile)) {
    proxyAddresses = readJSONSync(addressesFile);
  }

  for (let [contractId, { contractName, init }] of Object.entries(contracts)) {
    let proxyAddress;

    if (proxyAddresses[contractId]) {
      ({ proxy: proxyAddress } = proxyAddresses[contractId]);
      await retry(async () => {
        console.log(`Upgrading ${contractId}...`);
        let factory = await makeFactory(contractName);
        await upgradeProxy(proxyAddress, factory);
      });
    } else {
      console.log(`Deploying new contract ${contractId}...`);
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

      let instance;

      await retry(async () => {
        try {
          console.log(`Creating factory`);
          let factory = await makeFactory(contractName);
          console.log(`Deploying proxy`);
          instance = await deployProxy(factory, init);
          console.log("Waiting for transaction");
          await instance.deployed();
        } catch (e) {
          throw new Error("It failed, retrying");
        }
      });

      ({ address: proxyAddress } = instance);
      proxyAddresses[contractId] = {
        proxy: proxyAddress,
        contractName,
      };
    }
    let unverifiedImpls = difference(implAddresses(network), [
      ...previousImpls,
      ...newImpls,
    ]);
    for (let impl of unverifiedImpls) {
      if (!skipVerify) {
        await verifyImpl(contractName, impl);
      }
      newImpls.push(impl);
      reverify.push({ name: contractName, address: impl });
    }
  }

  writeJSONSync(addressesFile, proxyAddresses);
  console.log("Deployed Contracts:");
  for (let [name, { proxy: address }] of Object.entries(proxyAddresses)) {
    console.log(`  ${name}: ${address}`);
  }

  if (reverify.length > 0) {
    console.log(`Implementation contract verifications:`);
    for (let { name, address } of reverify) {
      console.log(
        `env HARDHAT_NETWORK=${network} node scripts/verify.js ${name}@${address}`
      );
    }
  }
}

function implAddresses(network) {
  let networkId;
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
  return Object.values(json.impls).map((i) => i.address);
}

asyncMain(main);
