const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const DAICPXD = artifacts.require("DAICPXD.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const MultiSend = artifacts.require("MultiSend");

const {
    getGnosisSafeFromEventLog,
    CREATE_PREPAID_CARD_TOPIC,
    encodeMultiSendCall
} = require('./utils/general');

const {
    TokenHelper,
    ContractHelper
} = require("./utils/helper");


contract("Test contract by EOA", (accounts) => {
    const tokenMeta = ["DAICPXD Token", "DAICPXD", 18]

    let daicpxdToken,
        revenuePool,
        spendToken,
        prepaidCardManager,
        multiSend,
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
        daicpxdToken = await TokenHelper.deploy({
            TokenABIs: DAICPXD,
            args: [...tokenMeta, TokenHelper.amountOf(100)]
        });

        // Deploy and mint 100 daicpxd token for deployer as owner
        fakeDaicpxdToken = await TokenHelper.deploy({
            TokenABIs: DAICPXD,
            args: [...tokenMeta, TokenHelper.amountOf(100)]
        });


        // Transfer 20 daicpxd to supplier's wallet
        await fakeDaicpxdToken.transfer(
            supplierEOA,
            TokenHelper.amountOf(20), {
                from: tally,
            }
        );

        await daicpxdToken.transfer(supplierEOA, TokenHelper.amountOf(20), {
            from: tally
        });

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
            [daicpxdToken.address]
        );
    })

    it("Create muliple card by EOA account", async () => {

        let amounts = [1, 2, 10].map(amount => TokenHelper.amountOf(amount));

        let data = ContractHelper.encodeCreateCardsData(supplierEOA, amounts);

        let tx = await daicpxdToken.transferAndCall(prepaidCardManager.address, TokenHelper.amountOf(13), data, {
            from: supplierEOA
        });

        cards = await getGnosisSafeFromEventLog(tx, prepaidCardManager.address);

        assert.equal(cards.length, 3);

        for (let i = 0; i < cards.length; ++i) {
            let card = cards[i];
            assert.ok(await card.isOwner(supplierEOA));
            await TokenHelper.isEqualBalance(daicpxdToken, card.address, amounts[i])
        }

        await TokenHelper.isEqualBalance(daicpxdToken, supplierEOA, TokenHelper.amountOf(7));
    })

    it('Create muliple card by EOA account failed because not enough token', async () => {
        try {
            let amounts = [1, 2, 3].map(amount => TokenHelper.amountOf(amount));

            let data = ContractHelper.encodeCreateCardsData(supplierEOA, amounts);

            let tx = await daicpxdToken.transferAndCall(prepaidCardManager.address, TokenHelper.amountOf(10), data, {
                from: supplierEOA
            });
            assert.ok(false, "Should failed");
        } catch (err) {
            assert.equal(err.reason, "ERC20: transfer amount exceeds balance");
        }
    })

    it('Create muliple card by EOA account failed because your amount must be == sum of new cardAmounts', async () => {
        try {
            let amounts = [1, 2, 9].map(amount => TokenHelper.amountOf(amount));

            let data = ContractHelper.encodeCreateCardsData(supplierEOA, amounts)

            let tx = await daicpxdToken.transferAndCall(prepaidCardManager.address, TokenHelper.amountOf(6), data, {
                from: supplierEOA
            });
            assert.ok(false, "Should failed");
        } catch (err) {
            assert.equal(err.reason, "your amount must be == sum of new cardAmounts");
        }
    })


})
