const DAICPXD = artifacts.require('DAICPXD.sol');
const RevenuePool = artifacts.require('RevenuePool.sol');
const SPEND = artifacts.require('SPEND.sol');
const ProxyFactory = artifacts.require('GnosisSafeProxyFactory');
const GnosisSafe = artifacts.require('GnosisSafe');

const utils = require('./utils/general');

contract('Test Revenue Pool contract', accounts => {
    let daicpxdToken, revenuePool, spendToken, fakeToken;
    let walletOfMerchant, lw, tally;
    let offchainId;
    before(async() => {
        offchainId = "offchain"
        lw = await utils.createLightwallet()
        tally = accounts[0];

        let proxyFactory = await ProxyFactory.new()
        let gnosisSafeMasterCopy = await utils.deployContract('deploying Gnosis Safe Mastercopy', GnosisSafe);

        revenuePool = await RevenuePool.new({from: accounts[0]});
        
        spendToken = await SPEND.new('SPEND Token', 'SPEND', [revenuePool.address]);

        // deploy and mint 10 daicpxd token for deployer as owner
        daicpxdToken = await DAICPXD.new("10000000000000000000");

        // setup for revenue pool
        await revenuePool.setup(
            tally,
            gnosisSafeMasterCopy.address, proxyFactory.address,
            spendToken.address,
            [daicpxdToken.address]
        );
        
        fakeToken = await DAICPXD.new("10000000000000000000");

        console.log('  Spend Token: ' + spendToken.address);
        console.log('  Daicpxd Token: ' +  daicpxdToken.address)
        console.log('  Revenue Pool: ' + revenuePool.address);
        console.log('\n');
    })

    it('merchant resigter by tally', async() => {
        await revenuePool.registerMerchant(lw.accounts[0], offchainId,  {from : tally});
        walletOfMerchant = await revenuePool.getMerchantWallet(lw.accounts[0], 0);
        assert.ok(true, "The merchant should be created.");
    })

    it('merchant resigter not by tally', async() => {
        try {
            await revenuePool.registerMerchant(lw.accounts[0], offchainId, {from : accounts[2]});
            walletOfMerchant = await revenuePool.getMerchantWallet(lw.accounts[0]);
            assert.ok(false, "The merchant shouldn't be created.");
        } catch(err) {
            assert.equal(err.reason, "Tally: caller is not the tally");
        }
    })
    
    
    it('pay 1 DAI CPXD token to pool and mint SPEND token for merchant wallet', async() => {
        let amount = utils.toAmountToken('1'); // equal 1 * 10^18
        let data = web3.eth.abi.encodeParameters(['address', 'uint'], [lw.accounts[0], 0]);

        await daicpxdToken.transferAndCall(revenuePool.address, amount, data);

        let balanceOfMerchantSPEND = await spendToken.balanceOf(walletOfMerchant);
        let balanceCustomer = await daicpxdToken.balanceOf(accounts[0]);
        console.log(balanceOfMerchantSPEND.toString());
        console.log(balanceCustomer.toString());
        assert.equal(balanceCustomer.toString(), web3.utils.toWei('9')); 
        assert.equal(balanceOfMerchantSPEND.toString(), utils.fromDAICPXD2SPEND(1, 100));
    })

    it('redeem 100 SPEND for merchant by tally', async() => {
        let amountSPEND = utils.fromDAICPXD2SPEND(1, 100);

        await revenuePool.redeemRevenue(lw.accounts[0], 0, daicpxdToken.address, amountSPEND, {from: tally});

        let balanceOfMerchantSPEND = await spendToken.balanceOf(walletOfMerchant);
        let balanceOfMerchantDAICPXD = await daicpxdToken.balanceOf(walletOfMerchant);

        assert.equal(balanceOfMerchantDAICPXD.toString(), web3.utils.toWei('1'));
        assert.equal(balanceOfMerchantSPEND.toString(), '0');
    })

    it('pay 2 DAI CPXD token to pool and mint SPEND token for merchant wallet', async() => {
        let amount = utils.toAmountToken('2'); // equal 2 * 10^18
        let data = web3.eth.abi.encodeParameters(['address', 'uint'], [lw.accounts[0], 0]);

        await daicpxdToken.transferAndCall(revenuePool.address, amount, data);

        let balanceOfMerchantSPEND = await spendToken.balanceOf(walletOfMerchant);
        let balanceCustomer = await daicpxdToken.balanceOf(accounts[0]);

        assert.equal(balanceCustomer.toString(), web3.utils.toWei('7')); 
        assert.equal(balanceOfMerchantSPEND.toString(), utils.fromDAICPXD2SPEND(2, 100));
    })

    it('redeem 100 SPEND for merchant and sender is not tally', async() => {
        let amountSPEND = utils.fromDAICPXD2SPEND(1, 100);
        try {
            await revenuePool.redeemRevenue(lw.accounts[0], 0, daicpxdToken.address, amountSPEND, {from: accounts[2]});
            assert.ok(false, "Dont allow for do this.");
        } catch(err) {
            assert.equal(err.reason, "Tally: caller is not the tally");
        }
    })


    it('pay 1 DAI CPXD and receive address is not merchant', async() => {
        let balanceBefore = await daicpxdToken.balanceOf(accounts[0]);
        let data = web3.eth.abi.encodeParameters(['address', 'uint'], [lw.accounts[2], 0]);
        let amount = utils.toAmountToken(1); // 1 DAI CPXD
        try {
            await daicpxdToken.transferAndCall(revenuePool.address, amount, data);
            assert.ok(false);
        } catch(err) {
            console.log(err.message);
            assert.equal(err.reason, "Merchants not registered");
            assert.ok(true);
        }

        let balanceAfter = await daicpxdToken.balanceOf(accounts[0]);
        assert.equal(balanceAfter.toString(), balanceBefore.toString());
    })

    it('call tokenFallback from an invalid token contract(not allow use for pay)', async() => {
        try {
            await revenuePool.tokenFallback(accounts[0], 100, '0x');
            assert.ok(false);
        } catch(err) {
            assert.ok(true);
        }
    })

    it("call transferAndCall from contract which not payable", async() => {
        try {

            let amount = utils.toAmountToken('1'); // equal 1 * 10^18
            let data = web3.eth.abi.encodeParameter('address', lw.accounts[0]);

            await fakeToken.transferAndCall(revenuePool.address, amount, data);
            assert.ok(false, "Should not accept this token");
        } catch(err) {
            assert.equal(err.reason, "Guard: Token is not support payable by contract.");
        }
    })

    it("add more wallet for merchant", async() => {
        await revenuePool.createAndAddWallet(lw.accounts[0]); 
        assert.ok(await revenuePool.getMerchantWallet(lw.accounts[0], 1), "Should create new wallet and add to merchant record");
    })

    it("pay for new wallet", async() => {
        let amount = utils.toAmountToken('2'); // equal 2 * 10^18
        let data = web3.eth.abi.encodeParameters(['address', 'uint'], [lw.accounts[0], 1]);

        await daicpxdToken.transferAndCall(revenuePool.address, amount, data);

        let balanceOfMerchantSPEND = await spendToken.balanceOf(walletOfMerchant);
        let balanceCustomer = await daicpxdToken.balanceOf(accounts[0]);

        assert.equal(balanceCustomer.toString(), web3.utils.toWei('5')); 
        assert.equal(balanceOfMerchantSPEND.toString(), utils.fromDAICPXD2SPEND(2, 100));
    })
})