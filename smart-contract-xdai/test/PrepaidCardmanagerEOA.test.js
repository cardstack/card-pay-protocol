const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const ERC677Token = artifacts.require("ERC677Token.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const MultiSend = artifacts.require("MultiSend");

const {
    getGnosisSafeFromEventLog,
} = require('./utils/general');

const {
    toTokenUnit,
    encodeCreateCardsData,
    shouldSameBalance
} = require("./utils/helper");

const { expect, TOKEN_DETAIL_DATA } = require('./setup');

contract("Test contract by EOA", (accounts) => {

    let daicpxdToken,
        revenuePool,
        spendToken,
        prepaidCardManager,
        offChainId = "Id",
        fakeDaicpxdToken;
    let tally, customer, merchant, relayer, supplierEOA;

    let cards = [];

    before(async () => {
        tally = accounts[0];
        customer = accounts[2];
        merchant = accounts[3];
        relayer = accounts[4];
        supplierEOA = accounts[8];

        let proxyFactory = await ProxyFactory.new();
        let gnosisSafeMasterCopy = await GnosisSafe.new();

        multiSend = await MultiSend.new();
        revenuePool = await RevenuePool.new();

        spendToken = await SPEND.new("SPEND Token", "SPEND", [
            revenuePool.address,
        ]);

        // Deploy and mint 100 daicpxd token for deployer as owner
        daicpxdToken = await ERC677Token.new(...TOKEN_DETAIL_DATA)
        await daicpxdToken.mint(supplierEOA, toTokenUnit(20));
        // Deploy and mint 100 daicpxd token for deployer as owner
        fakeDaicpxdToken = await ERC677Token.new(...TOKEN_DETAIL_DATA)
        await fakeDaicpxdToken.mint(supplierEOA, toTokenUnit(20));


     

        prepaidCardManager = await PrepaidCardManager.new();

        // Setup for revenue pool
        await revenuePool.setup(
            tally,
            gnosisSafeMasterCopy.address,
            proxyFactory.address,
            spendToken.address,
            [daicpxdToken.address]
        );

        await revenuePool.registerMerchant(merchant, offChainId);

        await prepaidCardManager.setup(
            tally,
            gnosisSafeMasterCopy.address,
            proxyFactory.address,
            revenuePool.address,
            [daicpxdToken.address],
            100, 500000
        );
     
        
    })

    it("Create muliple card by EOA account", async () => {

        let amounts = [1, 2, 10].map(amount => toTokenUnit(amount));

        let data = encodeCreateCardsData(supplierEOA, amounts);

        let tx = await daicpxdToken.transferAndCall(prepaidCardManager.address, toTokenUnit(13), data, {
            from: supplierEOA
        });

        cards = await getGnosisSafeFromEventLog(tx, prepaidCardManager.address);

        assert.equal(cards.length, 3);

        for (let i = 0; i < cards.length; ++i) {
            let card = cards[i];
            assert.ok(await card.isOwner(supplierEOA));
            await shouldSameBalance(daicpxdToken, card.address, amounts[i])
        }

        await shouldSameBalance(daicpxdToken, supplierEOA, toTokenUnit(7));
    })

    it('Create muliple card by EOA account failed because not enough token', async () => {
        try {
            let amounts = [1, 2, 3].map(amount => toTokenUnit(amount));

            let data = encodeCreateCardsData(supplierEOA, amounts);

            let tx = await daicpxdToken.transferAndCall(prepaidCardManager.address, toTokenUnit(10), data, {
                from: supplierEOA
            });
            assert.ok(false, "Should failed");
        } catch (err) {
            assert.equal(err.reason, "ERC20: transfer amount exceeds balance");
        }
    })

    it('Create muliple card by EOA account failed because not enough token', async () => {
        try {
            let amounts = [1, 2, 9].map(amount => toTokenUnit(amount));

            let data = encodeCreateCardsData(supplierEOA, amounts)

            let tx = await daicpxdToken.transferAndCall(prepaidCardManager.address, toTokenUnit(6), data, {
                from: supplierEOA
            });
            assert.ok(false, "Should failed");
        } catch (err) {
            assert.equal(err.reason, "Not enough token");
        }
    })


})
