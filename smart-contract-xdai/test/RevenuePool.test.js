const DAICPXD = artifacts.require('DAICPXD.sol');
const RevenuePool = artifacts.require('RevenuePool.sol');
const SPEND = artifacts.require('SPEND.sol');
const ProxyFactory = artifacts.require('GnosisSafeProxyFactory');
const GnosisSafe = artifacts.require('./GnosisSafe.sol');
const utils = require('@gnosis.pm/safe-contracts/test/utils/general');

contract('Test Revenue Pool contract', accounts => {
    let daicpxdToken, revenuePool, spendToken;
    let walletOfMerchant, lw;

    before( async() => {
        lw = await utils.createLightwallet()

        let proxyFactory = await ProxyFactory.new()
        let gnosisSafeMasterCopy = await utils.deployContract('deploying Gnosis Safe Mastercopy', GnosisSafe);

        revenuePool = await utils.deployContract('deploying revenue pool', RevenuePool);

        spendToken = await SPEND.new('SPEND Token', 'SPEND', [revenuePool.address]);
        // deploy and mint 1000000 daicpxd token for deployer as owner
        daicpxdToken = await DAICPXD.new(1000000);

        // setup for revenue pool
        await revenuePool.setup(spendToken.address, daicpxdToken.address, proxyFactory.address, gnosisSafeMasterCopy.address);

        console.log('  Spend Token: ' + spendToken.address);
        console.log('  Daicpxd Token: ' +  daicpxdToken.address)
        console.log('  Revenue Pool: ' + revenuePool.address);
    })

    it('merchant resigter by onwer', async() => {
        await revenuePool.registerMerchant(lw.accounts[1], 'Alice');
        walletOfMerchant = await revenuePool.getWalletAddress(lw.accounts[1]);
    })

    it('send 10 DAI CPXD token to pool and mint spend for wallet', async() => {
        await daicpxdToken.transferAndCall(revenuePool.address, 10, web3.eth.abi.encodeParameter('address', lw.accounts[1]));
        let balanceOfAliceSPEND = await spendToken.balanceOf(walletOfMerchant);
        let balanceCustomer = await daicpxdToken.balanceOf(accounts[0]);

        assert.equal(balanceCustomer.toString(), '999990'); 
        assert.equal(balanceOfAliceSPEND.toString(), '1000');
    })

    it('redeem by merchant...', async() => {
        await revenuePool.redeemRevenue(lw.accounts[1], 1000);
        let balanceOfAliceSPEND = await spendToken.balanceOf(walletOfMerchant);
        let balanceOfAliceDAI = await daicpxdToken.balanceOf(walletOfMerchant);

        assert.equal(balanceOfAliceDAI.toString(), '10');
        assert.equal(balanceOfAliceSPEND.toString(), '0');
    })

    it('send 10 DAI CPXD and receive address is not merchant', async() => {
        let balanceBefore = await daicpxdToken.balanceOf(accounts[0]);
        try {
            await daicpxdToken.transferAndCall(revenuePool.address, 10, web3.eth.abi.encodeParameter('address', lw.accounts[2]));
            assert.ok(false)
        } catch(err) {
            assert.ok(true)
        }

        let balanceAfter = await daicpxdToken.balanceOf(accounts[0]);
        assert.equal(balanceAfter.toString(), balanceBefore.toString());
    })

    it('call tokenFallback not from dai token contract', async() => {
        try {
            await revenuePool.tokenFallback(accounts[0], 100, '0x');
            assert.ok(false);
        } catch(err) {
            assert.ok(true);
        }
    })
})