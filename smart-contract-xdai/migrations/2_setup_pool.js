const RevenuePool = artifacts.require("RevenuePool");
const SPEND = artifacts.require('SPEND');

module.exports = async function(deployer, network, account) {

    if (network == "ganache")  
        return;

    let pool = await RevenuePool.deployed();

    await deployer.deploy(SPEND, "SPEND Token", "SPEND", [
        pool.address,
    ]);

    let spend = await SPEND.deployed();

    await pool.setup(
        process.env.TALLY,
        process.env.GNOSIS_SAFE_MASTER_COPY,
        process.env.GNOSIS_SAFE_FACTORY,
        spend.address,
        process.env.PAYABLE_TOKEN.split(' ')
    )
}