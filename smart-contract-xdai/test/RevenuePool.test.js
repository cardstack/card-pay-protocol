const ERC677Token = artifacts.require('ERC677Token.sol');
const RevenuePool = artifacts.require('RevenuePool.sol');
const SPEND = artifacts.require('SPEND.sol');
const ProxyFactory = artifacts.require('GnosisSafeProxyFactory');
const GnosisSafe = artifacts.require('GnosisSafe');

const utils = require('./utils/general');
const eventABIs = require('./utils/constant/eventABIs');

const { expect, TOKEN_DETAIL_DATA, toBN } = require('./setup');

const { toTokenUnit, shouldSameBalance } = require('./utils/helper');
const { should } = require('chai');

contract('Test Revenue Pool contract', accounts => {

    let daicpxdToken, revenuePool, spendToken, fakeToken;
    let lw, tally, merchant;
    let offchainId;

    before(async () => {
        offchainId = "offchain"
        lw = await utils.createLightwallet()
        tally = accounts[0];

        let proxyFactory = await ProxyFactory.new()
        let gnosisSafeMasterCopy = await utils.deployContract('deploying Gnosis Safe Mastercopy', GnosisSafe);

        revenuePool = await RevenuePool.new();

        spendToken = await SPEND.new('SPEND Token', 'SPEND', [revenuePool.address]);

        // deploy and mint 10 daicpxd token for deployer as owner
        daicpxdToken = await ERC677Token.new(...TOKEN_DETAIL_DATA)
        await daicpxdToken.mint(accounts[0], toTokenUnit(100));
        // setup for revenue pool
        await revenuePool.setup(
            tally,
            gnosisSafeMasterCopy.address, proxyFactory.address,
            spendToken.address,
            [daicpxdToken.address]
        );

        fakeToken = await ERC677Token.new(...TOKEN_DETAIL_DATA);
        await fakeToken.mint(accounts[0], toTokenUnit(100));

    })

    it('merchant resigter by tally', async () => {
        let tx = await revenuePool.registerMerchant(lw.accounts[0], offchainId, {
            from: tally
        }).should.be.fulfilled;
        let merchantCreation = await utils.getParamsFromEvent(tx, eventABIs.MERCHANT_CREATION, revenuePool.address);
        merchant = merchantCreation[0]['merchant'];
        await revenuePool.isMerchant(merchant).should.become(true);
    })

    it('merchant resigter by tally but merchant address is zero', async () => {
        await revenuePool.registerMerchant(utils.ZERO_ADDRESS, offchainId, {
            from: tally
        }).should.be.rejectedWith(Error, "Merchant address shouldn't zero address");
    })

    it('merchant resigter not by tally', async () => {
        await revenuePool.registerMerchant(lw.accounts[0], offchainId, {
            from: accounts[2]
        }).should.be.rejectedWith(Error, "Tally: caller is not the tally");
    })


    it('pay 1 DAI CPXD token to pool and mint SPEND token for merchant wallet', async () => {
        let amount = toTokenUnit(1);
        let data = web3.eth.abi.encodeParameters(['address'], [merchant]);

        await daicpxdToken.transferAndCall(revenuePool.address, amount, data)
            .should.be.fulfilled;

        await shouldSameBalance(daicpxdToken, accounts[0], toTokenUnit(99))
        await shouldSameBalance(spendToken, merchant, '100');
    })

    it('claim 1 DAI CPXD for merchant by tally', async () => {
        let amount = toTokenUnit(1);

        await revenuePool.claimTokens(merchant, [daicpxdToken.address], [amount], {
            from: tally
        }).should.be.fulfilled;

        await shouldSameBalance(daicpxdToken, merchant, toTokenUnit(1))
        await shouldSameBalance(spendToken, merchant, '100');
    })

    it('claim with wrong data for merchant by tally', async () => {

        await revenuePool.claimTokens(merchant, [daicpxdToken.address], [], {
            from: tally
        }).should.be.rejected;

    })

    it('pay 2 DAI CPXD token to pool and mint SPEND token for merchant wallet', async () => {
        let amount = toTokenUnit(2); // equal 2 * 10^18
        let data = web3.eth.abi.encodeParameters(['address'], [
            merchant
        ]);

        await daicpxdToken.transferAndCall(revenuePool.address, amount, data);

        await shouldSameBalance(daicpxdToken, accounts[0], toTokenUnit(97))
        await shouldSameBalance(spendToken, merchant, '300');
    })

    it('claim 1 for merchant and sender is not tally', async () => {
        let amount = toTokenUnit(1);
        await revenuePool.claimTokens(merchant, [daicpxdToken.address], [amount], {
            from: accounts[2]
        }).should.be.rejected;
    })


    it('pay 1 DAI CPXD and receive address is not merchant', async () => {
        let balanceBefore = await daicpxdToken.balanceOf(accounts[0]);
        //lw.accounts[1] is not merchant.
        let data = web3.eth.abi.encodeParameters(['address'], [lw.accounts[1]]);
        let amount = toTokenUnit(1); // 1 DAI CPXD

        await daicpxdToken.transferAndCall(revenuePool.address, amount, data)
            .should.be.rejectedWith(Error, "merchant not exist");

        await shouldSameBalance(daicpxdToken, accounts[0], balanceBefore);
    })

    it('call onTokenTransfer from an invalid token contract(not allow use for pay)', async () => {
        await revenuePool.onTokenTransfer(accounts[0], 100, '0x').should.be.rejected;
    })

    it("call transferAndCall from contract which not payable", async () => {
        let amount = toTokenUnit('1'); // equal 1 * 10^18
        let data = web3.eth.abi.encodeParameter('address', lw.accounts[0]);

        await fakeToken.transferAndCall(revenuePool.address, amount, data)
            .should.be.rejectedWith(Error, "Guard: Token is not support payable by contract.");
    })

    it("set up wrong data", async () => {
        await revenuePool.setup(
            tally,
            accounts[9], accounts[4],
            spendToken.address,
            [daicpxdToken.address]
        )

        await revenuePool.registerMerchant(lw.accounts[4], offchainId, {
            from: tally
        }).should.be.rejected;

    })
})
