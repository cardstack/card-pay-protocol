const hre = require("hardhat");
const { existsSync, readJSONSync } = require("node-fs-extra");
const { resolve } = require("path");
const { asyncMain, makeFactory } = require("./util");
const { main: configManualFeeds } = require("./002_configure_manual_feeds.js");
const {
  main: configPriceOracles,
} = require("./003_configure_price_oracles.js");
const { main: configProtocol } = require("./004_configure_card_protocol.js");
const { ethers } = hre;

// add not-yet-deployed contracts to object
function patchContracts(contracts) {
  return {
    ...contracts,
    ...{
      PrepaidCardMarket: {
        contractName: "PrepaidCardMarket",
      },
      SetPrepaidCardInventoryHandler: {
        contractName: "SetPrepaidCardInventoryHandler",
      },
      RemovePrepaidCardInventoryHandler: {
        contractName: "RemovePrepaidCardInventoryHandler",
      },
      SetPrepaidCardAskHandler: {
        contractName: "SetPrepaidCardAskHandler",
      },
      RewardManager: { contractName: "RewardManager" },
      AddRewardRuleHandler: {
        contractName: "AddRewardRuleHandler",
      },
      LockRewardProgramHandler: {
        contractName: "LockRewardProgramHandler",
      },
      RegisterRewardProgramHandler: {
        contractName: "RegisterRewardProgramHandler",
      },
      RegisterRewardeeHandler: {
        contractName: "RegisterRewardeeHandler",
      },
      RemoveRewardRuleHandler: {
        contractName: "RemoveRewardRuleHandler",
      },
      UpdateRewardProgramAdminHandler: {
        contractName: "UpdateRewardProgramAdminHandler",
      },
      PayRewardTokensHandler: {
        contractName: "PayRewardTokensHandler",
      },
      CARDOracle: {
        contractName: "ChainlinkFeedAdapter",
      },
      CARDUSDFeed: {
        contractName: "ManualFeed",
      },
    },
  };
}
function getContracts(shadowNetwork) {
  const addressesFile = resolve(
    __dirname,
    "..",
    "..",
    ".openzeppelin",
    `addresses-${shadowNetwork}.json`
  );
  if (!existsSync(addressesFile)) {
    throw new Error(`Cannot read from the addresses file ${addressesFile}`);
  }
  return readJSONSync(addressesFile);
}

async function deployContracts(shadowNetwork = "sokol") {
  console.log(`Deploying protocol to private network`);
  let addresses = {};
  let contracts = getContracts(shadowNetwork);
  contracts = patchContracts(contracts);
  for (let contractId of Object.keys(contracts)) {
    let contractName = contracts[contractId].contractName;
    let factory = await makeFactory(contractName);
    let signer = factory.signer;
    let instance = await factory.deploy();
    await instance.deployed();
    let writeableInstance = await new ethers.Contract(
      instance.address,
      instance.interface.fragments,
      signer
    );
    await writeableInstance.initialize(signer.address);
    addresses[contractId] = { proxy: instance.address, contractName };
  }

  for (let contract of ["GnosisSafe", "GnosisSafeProxyFactory"]) {
    let factory = await makeFactory(contract);
    let instance = await factory.deploy();
    await instance.deployed();
    addresses[contract] = { proxy: instance.address, contractName: contract };
  }

  for (let contract of ["CARD", "DAI"]) {
    let factory = await makeFactory("ERC677Token");
    let signer = factory.signer;
    let instance = await factory.deploy();
    await instance.deployed();
    addresses[contract] = {
      proxy: instance.address,
      contractName: "ERC677Token",
    };

    let writeableInstance = await new ethers.Contract(
      instance.address,
      instance.interface.fragments,
      signer
    );
    await writeableInstance["initialize(string,string,uint8,address)"](
      contract,
      contract,
      18,
      signer.address
    );
  }

  return addresses;
}

async function configureContracts(addresses) {
  process.env.PAYABLE_TOKENS = process.env.PAYABLE_TOKENS ?? [
    addresses["CARD"].proxy,
    addresses["DAI"].proxy,
  ];

  process.env.GNOSIS_SAFE_MASTER_COPY =
    process.env.GNOSIS_SAFE_MASTER_COPY ?? addresses["GnosisSafe"].proxy;

  process.env.GNOSIS_SAFE_FACTORY =
    process.env.GNOSIS_SAFE_FACTORY ??
    addresses["GnosisSafeProxyFactory"].proxy;

  await configProtocol(addresses);
}

async function main() {
  let addresses = await deployContracts();
  await configManualFeeds(addresses);
  await configPriceOracles(addresses);
  await configureContracts(addresses);
  let [signer] = await ethers.getSigners();
  console.log(`

================================================================================
Completed deploying to private network
(owner ${signer.address})
`);
  for (let contract of Object.keys(addresses)) {
    console.log(`  ${contract.padEnd(35, " ")} ${addresses[contract].proxy}`);
  }
}

asyncMain(main);
