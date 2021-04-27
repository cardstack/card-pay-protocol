const { readJSONSync, existsSync } = require("node-fs-extra");

const RevenuePool = artifacts.require("RevenuePool");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const BridgeUtils = artifacts.require("BridgeUtils");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TALLY = process.env.TALLY ?? ZERO_ADDRESS;
const BRIDGE_MEDIATOR = process.env.BRIDGE_MEDIATOR ?? ZERO_ADDRESS;
const GNOSIS_SAFE_MASTER_COPY =
  process.env.GNOSIS_SAFE_MASTER_COPY ??
  "0x6851d6fdfafd08c0295c392436245e5bc78b0185";
const GNOSIS_SAFE_FACTORY =
  process.env.GNOSIS_SAFE_FACTORY ??
  "0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B";
const MINIMUM_AMOUNT = process.env.MINIMUM_AMOUNT ?? "100"; // minimum face value (in SPEND) for new prepaid card
const MAXIMUM_AMOUNT = process.env.MAXIMUM_AMOUNT ?? "10000000"; // maximum face value (in SPEND) for new prepaid card

module.exports = async function (deployer, network) {
  if (["ganache", "test", "soliditycoverage"].includes(network)) {
    return;
  }
  const addressesFile = `./.openzeppelin/addresses-${network}.json`;
  if (!existsSync(addressesFile)) {
    throw new Error(`Cannot read from the addresses file ${addressesFile}`);
  }
  let proxyAddresses = readJSONSync(addressesFile);

  // RevenuePool configuration
  let revenuePoolAddress = getAddress("RevenuePool", proxyAddresses);
  let prepaidCardManagerAddress = getAddress(
    "PrepaidCardManager",
    proxyAddresses
  );
  let revenuePool = await RevenuePool.at(revenuePoolAddress);
  let spendTokenAddress = getAddress("SPEND", proxyAddresses);
  let daiFeed = getAddress("DAIFeed", proxyAddresses);
  let cardFeed = getAddress("CARDFeed", proxyAddresses);
  let bridgeUtilsAddress = getAddress("BridgeUtils", proxyAddresses);
  console.log(`
==================================================`);
  console.log(`Configuring RevenuePool ${revenuePoolAddress}`);
  console.log(`  tally address: ${TALLY}`);
  console.log(`  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}`);
  console.log(`  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}`);
  console.log(`  SPEND token address: ${spendTokenAddress}`);
  await revenuePool.setup(
    TALLY,
    GNOSIS_SAFE_MASTER_COPY,
    GNOSIS_SAFE_FACTORY,
    spendTokenAddress,
    []
  );
  console.log(`  set BridgeUtils address to ${bridgeUtilsAddress}`);
  await revenuePool.setBridgeUtils(bridgeUtilsAddress);
  console.log(`  add DAI/USD feed at ${daiFeed}`);
  await revenuePool.createExchange("DAI", daiFeed);
  console.log(`  add CARD/USD feed at ${cardFeed}`);
  await revenuePool.createExchange("CARD", cardFeed);

  // PrepaidCardManager configuration
  let prepaidCardManager = await PrepaidCardManager.at(
    prepaidCardManagerAddress
  );
  console.log(`
==================================================`);
  console.log(`Configuring PrepaidCardManager ${prepaidCardManagerAddress}`);
  console.log(`  tally address: ${TALLY}`);
  console.log(`  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}`);
  console.log(`  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}`);
  console.log(`  RevenuePool address: ${revenuePoolAddress}`);
  console.log(`  minimum face value: ${MINIMUM_AMOUNT}`);
  console.log(`  maximum face value: ${MAXIMUM_AMOUNT}`);
  await prepaidCardManager.setup(
    TALLY,
    GNOSIS_SAFE_MASTER_COPY,
    GNOSIS_SAFE_FACTORY,
    revenuePoolAddress,
    [],
    MINIMUM_AMOUNT,
    MAXIMUM_AMOUNT
  );
  console.log(`  set BridgeUtils address to ${bridgeUtilsAddress}`);
  await prepaidCardManager.setBridgeUtils(bridgeUtilsAddress);

  // BridgeUtils configuration
  let bridgeUtils = await BridgeUtils.at(bridgeUtilsAddress);
  console.log(`
==================================================`);
  console.log(`Configuring BridgeUtils ${bridgeUtilsAddress}`);
  console.log(`  RevenuePool address: ${revenuePoolAddress}`);
  console.log(`  PrepaidCardManager address: ${prepaidCardManagerAddress}`);
  console.log(`  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}`);
  console.log(`  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}`);
  console.log(`  bridge mediator address: ${BRIDGE_MEDIATOR}`);
  await bridgeUtils.setup(
    revenuePoolAddress,
    prepaidCardManagerAddress,
    GNOSIS_SAFE_MASTER_COPY,
    GNOSIS_SAFE_FACTORY,
    BRIDGE_MEDIATOR
  );
};

function getAddress(contractId, addresses) {
  let info = addresses[contractId];
  if (!info?.proxy) {
    throw new Error(
      `Cannot find proxy address for ${contractId} in addresses file`
    );
  }
  return info.proxy;
}
