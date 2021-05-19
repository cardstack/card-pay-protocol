const { readJSONSync, existsSync } = require("node-fs-extra");
const Web3 = require("web3");
const { fromWei } = Web3.utils;

const RevenuePool = artifacts.require("RevenuePool");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const BridgeUtils = artifacts.require("BridgeUtils");
const SPEND = artifacts.require("SPEND");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TALLY = process.env.TALLY ?? ZERO_ADDRESS;
const GAS_FEE_RECEIVER = process.env.GAS_FEE_RECEIVER ?? ZERO_ADDRESS;
const GAS_FEE_CARD_WEI = String(
  process.env.GAS_FEE_CARD_WEI ?? 1000000000000000000
);
const BRIDGE_MEDIATOR = process.env.BRIDGE_MEDIATOR ?? ZERO_ADDRESS;
const PAYABLE_TOKENS = (process.env.PAYABLE_TOKENS ?? "")
  .split(",")
  .map((t) => t.trim());
const GAS_TOKEN = process.env.GAS_TOKEN ?? ZERO_ADDRESS;
const GNOSIS_SAFE_MASTER_COPY =
  process.env.GNOSIS_SAFE_MASTER_COPY ??
  "0x6851d6fdfafd08c0295c392436245e5bc78b0185";
const GNOSIS_SAFE_FACTORY =
  process.env.GNOSIS_SAFE_FACTORY ??
  "0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B";
const MINIMUM_AMOUNT = process.env.MINIMUM_AMOUNT ?? "100"; // minimum face value (in SPEND) for new prepaid card
const MAXIMUM_AMOUNT = process.env.MAXIMUM_AMOUNT ?? "100000"; // maximum face value (in SPEND) for new prepaid card

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
  let daiOracleAddress = getAddress("DAIOracle", proxyAddresses);
  let cardOracleAddress = getAddress("CARDOracle", proxyAddresses);
  let bridgeUtilsAddress = getAddress("BridgeUtils", proxyAddresses);
  console.log(`
==================================================
Configuring RevenuePool ${revenuePoolAddress}
  tally address: ${TALLY}
  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}
  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}
  payable tokens: ${PAYABLE_TOKENS.join(", ")}
  SPEND token address: ${spendTokenAddress}`);
  await revenuePool.setup(
    TALLY,
    GNOSIS_SAFE_MASTER_COPY,
    GNOSIS_SAFE_FACTORY,
    spendTokenAddress,
    PAYABLE_TOKENS
  );
  console.log(`  set BridgeUtils address to ${bridgeUtilsAddress}`);
  await revenuePool.setBridgeUtils(bridgeUtilsAddress);
  console.log(`  set DAI oracle to ${daiOracleAddress}`);
  await revenuePool.createExchange("DAI", daiOracleAddress);
  console.log(`  set CARD oracle to ${cardOracleAddress}`);
  await revenuePool.createExchange("CARD", cardOracleAddress);

  // PrepaidCardManager configuration
  let prepaidCardManager = await PrepaidCardManager.at(
    prepaidCardManagerAddress
  );
  console.log(`
==================================================
Configuring PrepaidCardManager ${prepaidCardManagerAddress}
  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}
  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}
  RevenuePool address: ${revenuePoolAddress}
  gas fee receiver: ${GAS_FEE_RECEIVER}
  gas fee: ${fromWei(GAS_FEE_CARD_WEI)} CARD
  payable tokens: ${PAYABLE_TOKENS.join(", ")}
  gas token: ${GAS_TOKEN}
  minimum face value: ${MINIMUM_AMOUNT}
  maximum face value: ${MAXIMUM_AMOUNT}`);
  await prepaidCardManager.setup(
    GNOSIS_SAFE_MASTER_COPY,
    GNOSIS_SAFE_FACTORY,
    revenuePoolAddress,
    GAS_FEE_RECEIVER,
    GAS_FEE_CARD_WEI,
    PAYABLE_TOKENS,
    GAS_TOKEN,
    MINIMUM_AMOUNT,
    MAXIMUM_AMOUNT
  );
  console.log(`  set BridgeUtils address to ${bridgeUtilsAddress}`);
  await prepaidCardManager.setBridgeUtils(bridgeUtilsAddress);

  // BridgeUtils configuration
  let bridgeUtils = await BridgeUtils.at(bridgeUtilsAddress);
  console.log(`
==================================================
Configuring BridgeUtils ${bridgeUtilsAddress}
  RevenuePool address: ${revenuePoolAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}
  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}
  bridge mediator address: ${BRIDGE_MEDIATOR}`);
  await bridgeUtils.setup(
    revenuePoolAddress,
    prepaidCardManagerAddress,
    GNOSIS_SAFE_MASTER_COPY,
    GNOSIS_SAFE_FACTORY,
    BRIDGE_MEDIATOR
  );

  // SPEND configuration
  let spend = await SPEND.at(spendTokenAddress);
  console.log(`
==================================================
Configuring SPEND: ${spendTokenAddress}
  adding minter: ${revenuePoolAddress} (revenue pool)`);
  await spend.addMinter(revenuePoolAddress);
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
