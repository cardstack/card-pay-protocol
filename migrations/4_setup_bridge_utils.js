const BridgeUtils = artifacts.require("BridgeUtils");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const {
  TALLY,
  GNOSIS_SAFE_FACTORY,
  GNOSIS_SAFE_MASTER_COPY,
  BRIDGE_MEDIATOR,
} = require("./constants");

module.exports = async function (_, network) {
  if (["ganache", "test", "soliditycoverage"].includes(network)) {
    return;
  }

  let bridgeUtils = await BridgeUtils.deployed();
  let pool = await RevenuePool.deployed();
  let prepaidCardManager = await PrepaidCardManager.deployed();

  await bridgeUtils.setup(
    pool.address,
    prepaidCardManager.address,
    GNOSIS_SAFE_MASTER_COPY,
    GNOSIS_SAFE_FACTORY,
    BRIDGE_MEDIATOR
  );
  console.log(`configured bridge utils:
  Tally contract address:       ${TALLY}
  Gnosis safe master copy:      ${GNOSIS_SAFE_MASTER_COPY}
  Gnosis safe factory:          ${GNOSIS_SAFE_FACTORY}
  Revenue pool address:         ${pool.address}
  Prepaid card manager address: ${prepaidCardManager.address}
  Bridge mediator address:      ${BRIDGE_MEDIATOR}
`);
};
