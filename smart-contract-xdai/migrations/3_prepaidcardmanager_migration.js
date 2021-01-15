const PrepaidCardManager = artifacts.require("PrepaidCardManager"); 
const RevenuePool = artifacts.require("RevenuePool.sol");

module.exports = async function (deployer) {
    await deployer.deploy(PrepaidCardManager);
    let prepaidCardManager = await PrepaidCardManager.deployed();
    let pool = await RevenuePool.deployed();

    await prepaidCardManager.setup(
        process.env.TALLY, 
        process.env.GNOSIS_SAFE_MASTER_COPY, 
        process.env.GNOSIS_SAFE_FACTORY, 
        pool.address,
        process.env.PAYABLE_TOKEN.split(' ')
    ) 
};
