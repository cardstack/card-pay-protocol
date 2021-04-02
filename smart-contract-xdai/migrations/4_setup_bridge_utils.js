const BridgeUtils = artifacts.require("BridgeUtils");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");

const GNOSIS_SAFE_MASTER_COPY =
  process.env.GNOSIS_SAFE_MASTER_COPY ??
  `0x6851d6fdfafd08c0295c392436245e5bc78b0185`;
const GNOSIS_SAFE_FACTORY =
  process.env.GNOSIS_SAFE_FACTORY ??
  `0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B`;
const BRIDGE_MEDIATOR = process.env.BRIDGE_MEDIATOR;
const RevenuePool = artifacts.require("RevenuePool");

module.exports = async function (_, network) {
  if (network === "ganache") {
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
};
