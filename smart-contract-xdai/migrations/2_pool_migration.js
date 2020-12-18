const DAICPXD = artifacts.require("DAICPXD");
const RevenuePool = artifacts.require("RevenuePool");
const SPEND = artifacts.require("SPEND");

module.exports = async function (deployer) {
    //deployer.deploy(DAICPXD, "DAI CPXD Token", "DAICPXD", 16, '1000000000000000000000000')
    await deployer.deploy(RevenuePool);
    let pool = await RevenuePool.deployed()

    await deployer.deploy(SPEND, "SPEND Token", "SPEND", [pool.address]);
    let spend = await SPEND.deployed(); 

    await pool.setup(
        process.env.TALLY,
        process.env.GNOSIS_SAFE_MASTER_COPY, 
        process.env.GNOSIS_SAFE_FACTORY, 
        spend.address, 
        [process.env.PAYABLE_TOKEN]
    ) 
};
