const BridgeUtils = artifacts.require("BridgeUtils");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const {
  GNOSIS_SAFE_FACTORY,
  GNOSIS_SAFE_MASTER_COPY,
  BRIDGE_MEDIATOR,
} = require("./constants");

module.exports = async function (_, network) {
  if (network === "ganache") {
    return;
  }
  if (!BRIDGE_MEDIATOR) {
    throw new Error("Bridge Mediator is missing in your env file");
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
};
