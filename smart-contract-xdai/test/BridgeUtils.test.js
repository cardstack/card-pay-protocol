const BridgeUtils = artifacts.require('BridgeUtils');
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const GnosisFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisMaster = artifacts.require("GnosisSafe");

const utils = require('./utils/general');
contract("Bridge utils contract", async (accounts) => {
    let instance, pool, prepaidCardManager;
    let mediatorBridgeMock, wallet;
    before(async () => {

        let tallyAdmin = accounts[0];
        mediatorBridgeMock = accounts[1];
        instance = await BridgeUtils.new(tallyAdmin);
        pool = await RevenuePool.new();

        let gnosisFactory = await GnosisFactory.new();
        let gnosisMaster = await GnosisMaster.new();

        await pool.setup(
            tallyAdmin,
            instance.address,
            gnosisMaster.address,
            gnosisFactory.address,
            utils.Address0,
            []
        );

        prepaidCardManager = await PrepaidCardManager.new();

        await prepaidCardManager.setup(
            tallyAdmin,
            instance.address,
            gnosisMaster.address,
            gnosisFactory.address,
            pool.address,
            []
        )
        await instance.setUp(
            pool.address,
            prepaidCardManager.address,
            gnosisMaster.address,
            gnosisFactory.address,
            mediatorBridgeMock
        );
    })

    it("set up a new token", async () => {
        let tokenMock = accounts[2];

        await instance.updateToken(tokenMock, { from: mediatorBridgeMock });

        let payableToken = await pool.getTokens();

        assert.equal(
            payableToken.toString(),
            [tokenMock].toString()
        )
    })

    it("register new supplier - deploy a safe and store it's address", async () => {
        let account = accounts[2];
        let summary = await instance.registerSupplier(account, { from: mediatorBridgeMock });

        wallet = summary.receipt.logs[0].args[1];
        let gnosisSafe = await GnosisMaster.at(wallet);

        let onwers = await gnosisSafe.getOwners();
        assert.equal(onwers.toString(), [account].toString());
        let supplier = await instance.suppliers(wallet);
        assert.isTrue(supplier['registered'], true);
    })

    it("update supplier's profile - called by supplier ", async () => {
        let gnosisSafe = await GnosisMaster.at(wallet);
        let payload = instance.contract.methods.updateSupplier("Bob", "https://www.bob.com").encodeABI();
        let sigs = "0x000000000000000000000000" + accounts[2].replace('0x', '') + "0000000000000000000000000000000000000000000000000000000000000000" + "01"

        await gnosisSafe.execTransaction(
            instance.address,
            0,
            payload,
            0,
            0,
            0,
            0,
            utils.ZERO_ADDRESS,
            utils.ZERO_ADDRESS,
            sigs,
            { from: accounts[2] }
        );

        let supplier = await instance.suppliers(wallet);

        assert.isTrue(supplier['registered'], true);
        assert.equal(supplier['brandName'], "Bob");
        assert.equal(supplier['brandProfileUrl'], "https://www.bob.com");
    })
})