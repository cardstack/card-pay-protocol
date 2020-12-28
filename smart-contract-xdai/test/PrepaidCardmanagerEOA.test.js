const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const DAICPXD = artifacts.require("DAICPXD.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("gnosisSafe");
const MultiSend = artifacts.require("MultiSend");

const {
    getGnosisSafeFromEventLog,
    CREATE_PREPAID_CARD_TOPIC,
    encodeMultiSendCall, 
    ZERO_ADDRESS
} = require('./utils/general');

const {
    TokenHelper,
    ContractHelper
} = require("./utils/helper");


contract("Test contract by EOA", (accounts) => {

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
            args: [TokenHelper.toAmount(100, 2)]
        });

        // Deploy and mint 100 daicpxd token for deployer as owner
        fakeDaicpxdToken = await TokenHelper.deploy({
            TokenABIs: DAICPXD,
            args: [TokenHelper.toAmount(100, 2)]
        });


        // Transfer 20 daicpxd to supplier's wallet
        await fakeDaicpxdToken.transfer(
            supplierEOA,
            TokenHelper.toAmount(20, 2), {
                from: tally,
            }
        );

        await daicpxdToken.transfer(supplierEOA, TokenHelper.toAmount(20, 2), {
            from: tally
        });

        prepaidCardManager = await PrepaidCardManager.new();

        // Setup for revenue pool
        await revenuePool.setup(
            tally,
            ZERO_ADDRESS,
            gnosisSafeMasterCopy.address,
            proxyFactory.address,
            spendToken.address,
            [daicpxdToken.address]
        );

        await revenuePool.registerMerchant(merchant, offChainId);

        await prepaidCardManager.setup(
            tally,
            ZERO_ADDRESS,
            gnosisSafeMasterCopy.address,
            proxyFactory.address,
            revenuePool.address,
            [daicpxdToken.address]
        );
    })

    it("Create muliple card by EOA account", async () => {

        let amounts = [1, 2, 10].map(amount => TokenHelper.toAmount(amount, 2));

        let data = ContractHelper.prepageDataForCreateMutipleToken(supplierEOA, amounts);

        let tx = await daicpxdToken.transferAndCall(prepaidCardManager.address, TokenHelper.toAmount(13, 2), data, {
            from: supplierEOA
        });

        cards = await getGnosisSafeFromEventLog(tx, CREATE_PREPAID_CARD_TOPIC);

        assert.equal(cards.length, 3);

        for (let i = 0; i < cards.length; ++i) {
            let card = cards[i];
            assert.ok(await card.isOwner(supplierEOA));
            await TokenHelper.isEqualBalance(daicpxdToken, card.address, amounts[i])
        }

        await TokenHelper.isEqualBalance(daicpxdToken, supplierEOA, TokenHelper.toAmount(7, 2));
    })

    it('Create muliple card by EOA account failed because not enough token', async () => {
        try {
            let amounts = [1, 2, 3].map(amount => TokenHelper.toAmount(amount, 2));

            let data = ContractHelper.prepageDataForCreateMutipleToken(supplierEOA, amounts);

            let tx = await daicpxdToken.transferAndCall(prepaidCardManager.address, TokenHelper.toAmount(10, 2), data, {
                from: supplierEOA
            });
            assert.ok(false, "Should failed");
        } catch (err) {
            assert.equal(err.reason, "ERC20: transfer amount exceeds balance");
        }
    })


    it('Create muliple card by EOA account failed because your amount must be == sum of new cardAmounts', async () => {
        try {
            let amounts = [1, 2, 9].map(amount => TokenHelper.toAmount(amount,2));

            let data = ContractHelper.prepageDataForCreateMutipleToken(supplierEOA, amounts)

            let tx = await daicpxdToken.transferAndCall(prepaidCardManager.address, TokenHelper.toAmount(6, 2), data, {
                from: supplierEOA
            });
            assert.ok(false, "Should failed");
        } catch (err) {
            assert.equal(err.reason, "your amount must be == sum of new cardAmounts");
        }
    })


})