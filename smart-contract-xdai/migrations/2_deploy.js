const PrepaidCardManager = artifacts.require("PrepaidCardManager");
module.exports = async function(deployer) {
    await deployer.deploy(PrepaidCardManager);
}