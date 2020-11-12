const CardModule = artifacts.require("CardModule");

module.exports = function (deployer) {
	deployer.deploy(CardModule);
};
