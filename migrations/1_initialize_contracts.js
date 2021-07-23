const glob = require("glob");
const difference = require("lodash/difference");
const { writeJSONSync, readJSONSync, existsSync } = require("node-fs-extra");
const { verifyImpl } = require("../lib/verify");
const { deployProxy, upgradeProxy } = require("@openzeppelin/truffle-upgrades");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const BridgeUtils = artifacts.require("BridgeUtils");
const SPEND = artifacts.require("SPEND");
const Feed = artifacts.require("ManualFeed");
const ChainlinkOracle = artifacts.require("ChainlinkFeedAdapter");
const DIAOracle = artifacts.require("DIAOracleAdapter");
const RewardPool = artifacts.require("RewardPool");
const Exchange = artifacts.require("Exchange");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const PayMerchantHandler = artifacts.require("PayMerchantHandler");
const RegisterMerchantHandler = artifacts.require("RegisterMerchantHandler");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const MerchantManager = artifacts.require("MerchantManager");
const SplitPrepaidCardHandler = artifacts.require("SplitPrepaidCardHandler");
const TransferPrepaidCardHandler = artifacts.require(
  "TransferPrepaidCardHandler"
);

// we only maintain these migrations purely to measure the amount of gas it
// takes to perform a deployment for each contract
module.exports = async function (deployer, network, addresses) {
  console.log(`Deploying to ${network}`);

  if (["ganache", "test", "soliditycoverage"].includes(network)) {
    await Promise.all([
      // We use this to measure gas for all our contract creation. Please add
      // any new contracts here:
      deployer.deploy(PrepaidCardManager),
      deployer.deploy(RevenuePool),
      deployer.deploy(BridgeUtils),
      deployer.deploy(SPEND),
      deployer.deploy(Feed),
      deployer.deploy(ChainlinkOracle),
      deployer.deploy(DIAOracle),
      deployer.deploy(RewardPool),
      deployer.deploy(Exchange),
      deployer.deploy(ActionDispatcher),
      deployer.deploy(PayMerchantHandler),
      deployer.deploy(RegisterMerchantHandler),
      deployer.deploy(TokenManager),
      deployer.deploy(SupplierManager),
      deployer.deploy(MerchantManager),
      deployer.deploy(SplitPrepaidCardHandler),
      deployer.deploy(TransferPrepaidCardHandler),
    ]);
  } else {
    console.log(`Deploying from address ${addresses[0]}`);

    // Contract init details. For each upgradable contract provide a property
    // name that represents the contract "ID" (this is useful when there are
    // multiple instances of the same contract that need to be deployed), where
    // the value is an object that specifies the contract's name (as specified
    // in the solidity file), and an array of the initialize parameters to use
    // when creating the upgradable contract.
    let contracts = {
      PrepaidCardManager: {
        contractName: "PrepaidCardManager",
        init: [addresses[0]],
      },
      RevenuePool: { contractName: "RevenuePool", init: [addresses[0]] },
      RewardPool: { contractName: "RewardPool", init: [addresses[0]] },
      Exchange: { contractName: "Exchange", init: [addresses[0]] },
      ActionDispatcher: {
        contractName: "ActionDispatcher",
        init: [addresses[0]],
      },
      PayMerchantHandler: {
        contractName: "PayMerchantHandler",
        init: [addresses[0]],
      },
      RegisterMerchantHandler: {
        contractName: "RegisterMerchantHandler",
        init: [addresses[0]],
      },
      SplitPrepaidCardHandler: {
        contractName: "SplitPrepaidCardHandler",
        init: [addresses[0]],
      },
      TransferPrepaidCardHandler: {
        contractName: "TransferPrepaidCardHandler",
        init: [addresses[0]],
      },
      BridgeUtils: { contractName: "BridgeUtils", init: [addresses[0]] },
      TokenManager: { contractName: "TokenManager", init: [addresses[0]] },
      MerchantManager: {
        contractName: "MerchantManager",
        init: [addresses[0]],
      },
      SupplierManager: {
        contractName: "SupplierManager",
        init: [addresses[0]],
      },
      SPEND: { contractName: "SPEND", init: [addresses[0]] },
      DAIOracle: { contractName: "ChainlinkFeedAdapter", init: [addresses[0]] },
      CARDOracle: { contractName: "DIAOracleAdapter", init: [addresses[0]] },
    };

    // Use manual feeds in sokol
    if (network === "sokol") {
      contracts["DAIUSDFeed"] = {
        contractName: "ManualFeed",
        init: [addresses[0]],
      };
      contracts["ETHUSDFeed"] = {
        contractName: "ManualFeed",
        init: [addresses[0]],
      };
    }

    const addressesFile = `./.openzeppelin/addresses-${network}.json`;
    let skipVerify = process.argv.includes("--skipVerify");
    let proxyAddresses = {};
    let newImpls = [];
    let reverify = [];
    let previousImpls = implAddresses(network);
    if (existsSync(addressesFile)) {
      proxyAddresses = readJSONSync(addressesFile);
    }

    for (let [contractId, { contractName, init }] of Object.entries(
      contracts
    )) {
      let factory = artifacts.require(contractName);
      let proxyAddress;
      if (proxyAddresses[contractId]) {
        console.log(`
Upgrading ${contractId}...`);
        ({ proxy: proxyAddress } = proxyAddresses[contractId]);
        await upgradeProxy(proxyAddress, factory, { deployer });
      } else {
        console.log(`
Deploying new contract ${contractId}...`);
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
        let instance = await deployProxy(factory, init, { deployer });
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
          await verifyImpl(impl, contractName, network, "MIT");
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
      console.log(`
Implementation contract verifications:`);
      for (let { name, address } of reverify) {
        console.log(
          `npx truffle run blockscout ${name}@${address} --network ${network} --license MIT`
        );
      }
      console.log();
    }
  }
};

function implAddresses(network) {
  let networkId;
  switch (network) {
    case "sokol":
      networkId = 77;
      break;
    case "xdai":
      networkId = 100;
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
