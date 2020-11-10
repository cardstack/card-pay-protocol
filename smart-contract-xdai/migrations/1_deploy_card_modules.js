const Migrations = artifacts.require("CardModule");

module.exports = function (deployer) {
	deployer.deploy(CardModule);
};
