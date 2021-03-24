const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");

module.exports = function (deployer) {
  deployer.deploy(PrepaidCardManager);
  deployer.deploy(RevenuePool);
};
