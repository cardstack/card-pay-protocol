const PrepaidCardManager = artifacts.require("PrepaidCardManager");

module.exports = async function (deployer) {
    let prepaidCardManager = await PrepaidCardManager.deployed();

    await prepaidCardManager.setup(
        process.env.TALLY, 
        process.env.GNOSIS_SAFE_MASTER_COPY,
        process.env.GNOSIS_SAFE_FACTORY,
        "0x0000000000000000000000000000000000000000",
        [process.env.PAYABLE_TOKEN]
    );
}