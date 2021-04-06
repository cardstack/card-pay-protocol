const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const L2Token = artifacts.require("ERC677Token");
const SPEND = artifacts.require("SPEND");
const BridgeUtils = artifacts.require("BridgeUtils");

const fs = require("fs");
const { join } = require("path");

module.exports = async function (_, network) {
  if (
    ["soliditycoverage", "test", "ganache", "sokol-fork", "xdai-fork"].includes(
      network
    )
  ) {
    return;
  }

  let prepaidCardManager = await PrepaidCardManager.deployed();
  let pool = await RevenuePool.deployed();
  let spend = await SPEND.deployed();
  let l2Token = await L2Token.deployed();
  let bridgeUtils = await BridgeUtils.deployed();

  let addresses = {
    RevenuePool: pool.address,
    PrepaidCardManager: prepaidCardManager.address,
    SPEND: spend.address,
    ERC677Token: l2Token.address,
    BridgeUtils: bridgeUtils.address,
  };
  fs.writeFileSync(
    join(__dirname, `../addresses-${network}.json`),
    JSON.stringify(addresses, null, 2)
  );
};
