const DAICPXD = artifacts.require("DAICPXD");

module.exports = function (deployer) {
  deployer.deploy(DAICPXD, "DAI CPXD Token", "DAICPXD", 16, '1000000000000000000000000')
};
