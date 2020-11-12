const PrepaidCardManager = artifacts.require("PrepaidCardManager");

module.exports = function (deployer) {
	deployer.deploy(PrepaidCardManager);
};
