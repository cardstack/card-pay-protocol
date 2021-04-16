const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const BridgeUtils = artifacts.require("BridgeUtils");
const SPEND = artifacts.require("SPEND");
const Feed = artifacts.require("ManualFeed");

// we only maintain these migrations purely to measure the amount of gas it
// takes to perform a deployment for each contract
module.exports = async function (deployer, network) {
  if (network === "test") {
    await Promise.all([
      deployer.deploy(PrepaidCardManager),
      deployer.deploy(RevenuePool),
      deployer.deploy(BridgeUtils),
      deployer.deploy(SPEND),
      deployer.deploy(Feed),
    ]);
  }
};
