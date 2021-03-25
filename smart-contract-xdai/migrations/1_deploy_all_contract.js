const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const DaicpxdToken = artifacts.require("ERC677Token");

module.exports = function (deployer) {
  const TOKEN_DETAIL_DATA = ["DAICPXD Token", "DAICPXD", 18];
  deployer.deploy(
    DaicpxdToken,
    ...TOKEN_DETAIL_DATA
  );
  deployer.deploy(PrepaidCardManager);
  deployer.deploy(RevenuePool);
};
