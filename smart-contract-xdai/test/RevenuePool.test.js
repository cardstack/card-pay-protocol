const DAICPXD = artifacts.require('ERC677Token.sol');
const RevenuePool = artifacts.require('RevenuePool.sol');
const SPEND = artifacts.require('SPEND.sol');
const ProxyFactory = artifacts.require('GnosisSafeProxyFactory');
const GnosisSafe = artifacts.require('GnosisSafe');

const utils = require('./utils/general');
const eventABIs = require('./utils/constant/eventABIs');

const TokenHelper = require('./utils/helper').TokenHelper;

contract('Test Revenue Pool contract', accounts => {
    const tokenMeta = ["DAICPXD Token", "DAICPXD", 18]

    let daicpxdToken, revenuePool, spendToken, fakeToken;
    let lw, tally, merchant;
    let offchainId;

    before(async () => {
        offchainId = "offchain"
        lw = await utils.createLightwallet()
        tally = accounts[0];

        let proxyFactory = await ProxyFactory.new()
        let gnosisSafeMasterCopy = await utils.deployContract('deploying Gnosis Safe Mastercopy', GnosisSafe);

        revenuePool = await RevenuePool.new({
            from: accounts[0]
        });

        spendToken = await SPEND.new('SPEND Token', 'SPEND', [revenuePool.address]);

        // deploy and mint 10 daicpxd token for deployer as owner
        daicpxdToken = await TokenHelper.deploy({
			TokenABIs: DAICPXD,
			args: [...tokenMeta, TokenHelper.amountOf(10)]
		});

        // setup for revenue pool
        await revenuePool.setup(
            tally,
            gnosisSafeMasterCopy.address, proxyFactory.address,
            spendToken.address,
            [daicpxdToken.address]
        );

        fakeToken = await TokenHelper.deploy({
			TokenABIs: DAICPXD,
			args: [...tokenMeta, TokenHelper.amountOf(10)]
		});

        console.log('  Spend Token: ' + spendToken.address);
        console.log('  Daicpxd Token: ' + daicpxdToken.address)
        console.log('  Revenue Pool: ' + revenuePool.address);
        console.log('\n');
    })

    it('merchant resigter by tally', async () => {
        let tx = await revenuePool.registerMerchant(lw.accounts[0], offchainId, {
            from: tally
        });
        
        let merchantCreation = await utils.getParamsFromEvent(tx, eventABIs.MERCHANT_CREATION, revenuePool.address);

        merchant = merchantCreation[0]['merchant'];
        assert.isTrue(await revenuePool.isMerchant(merchant), "The merchant should be created.");
    })

    it('merchant resigter by tally but merchant address is zero', async () => {
        let failed = false;
        try {
            await revenuePool.registerMerchant(utils.ZERO_ADDRESS, offchainId, {
                from: tally
            });
        } catch (err) {
            failed = true;
            assert.equal(err.reason, "Merchant address shouldn't zero address");
        }
        assert.isTrue(failed, "Should regsiter merchant with account zero");
    })


    it('merchant resigter not by tally', async () => {
        let failed = false;
        try {
            await revenuePool.registerMerchant(lw.accounts[0], offchainId, {
                from: accounts[2]
            });
            walletOfMerchant = await revenuePool.getMerchantWallet(lw.accounts[0]);
        } catch (err) {
            assert.equal(err.reason, "Tally: caller is not the tally");
            failed = true;
        }
        assert.isTrue(failed, "The merchant shouldn't be created.");
    })


    it('pay 1 DAI CPXD token to pool and mint SPEND token for merchant wallet', async () => {
        let amount = TokenHelper.amountOf(1); 
        let data = web3.eth.abi.encodeParameters(['address'], [merchant]);

        await daicpxdToken.transferAndCall(revenuePool.address, amount, data);

        let balanceOfMerchantSPEND = await spendToken.balanceOf(merchant);
        let balanceCustomer = await daicpxdToken.balanceOf(accounts[0]);
        assert.equal(balanceCustomer.toString(), TokenHelper.amountOf(9));
        assert.equal(balanceOfMerchantSPEND.toString(), '100');
    })

    it('claim 1 DAI CPXD for merchant by tally', async () => {
        let amount = TokenHelper.amountOf(1);

        await revenuePool.claimTokens(merchant, [daicpxdToken.address], [amount], {
            from: tally
        });

        let balanceOfMerchantDAICPXD = await daicpxdToken.balanceOf(merchant);
        let numberSPEND = await spendToken.balanceOf(merchant);

        assert.equal(balanceOfMerchantDAICPXD.toString(), TokenHelper.amountOf(1));
        assert.equal(numberSPEND.toString(), '100');
    })

    it('claim with wrong data for merchant by tally', async () => {
        let amount = TokenHelper.amountOf(1)
        let isRevert = false;
        try {
            await revenuePool.claimTokens(merchant, [daicpxdToken.address], [], {
                from: tally
            });
        } catch (err) {
            isRevert = true;
        }
        
        assert.ok(isRevert);
    })

    it('pay 2 DAI CPXD token to pool and mint SPEND token for merchant wallet', async () => {
        let amount = TokenHelper.amountOf(2); // equal 2 * 10^18
        let data = web3.eth.abi.encodeParameters(['address'], [
            merchant
        ]);

        await daicpxdToken.transferAndCall(revenuePool.address, amount, data);

        let balanceOfMerchantSPEND = await spendToken.balanceOf(merchant);
        let balanceCustomer = await daicpxdToken.balanceOf(accounts[0]);

        assert.equal(balanceCustomer.toString(), TokenHelper.amountOf(7));
        assert.equal(balanceOfMerchantSPEND.toString(), '300');
    })

    it('claim 1 for merchant and sender is not tally', async () => {
        let amount = '1';
        try {
            await revenuePool.claimTokens(merchant, [daicpxdToken.address], [amount], {
                from: accounts[2]
            });
            assert.ok(false, "Dont allow for do this.");
        } catch (err) {
            assert.equal(err.reason, "Tally: caller is not the tally");
        }
    })


    it('pay 1 DAI CPXD and receive address is not merchant', async () => {
        let balanceBefore = await daicpxdToken.balanceOf(accounts[0]);
        //lw.accounts[1] is not merchant.
        let data = web3.eth.abi.encodeParameters(['address'], [lw.accounts[1]]);
        let amount = TokenHelper.amountOf(1); // 1 DAI CPXD
        try {
            await daicpxdToken.transferAndCall(revenuePool.address, amount, data);
            assert.ok(false);
        } catch (err) {
            assert.equal(err.reason, "merchant not exist");
            assert.ok(true);
        }

        let balanceAfter = await daicpxdToken.balanceOf(accounts[0]);
        assert.equal(balanceAfter.toString(), balanceBefore.toString());
    })

    it('call tokenFallback from an invalid token contract(not allow use for pay)', async () => {
        try {
            await revenuePool.tokenFallback(accounts[0], 100, '0x');
            assert.ok(false);
        } catch (err) {
            assert.ok(true);
        }
    })

    it("call transferAndCall from contract which not payable", async () => {
        try {

            let amount = TokenHelper.amountOf('1'); // equal 1 * 10^18
            let data = web3.eth.abi.encodeParameter('address', lw.accounts[0]);

            await fakeToken.transferAndCall(revenuePool.address, amount, data);
            assert.ok(false, "Should not accept this token");
        } catch (err) {
            assert.equal(err.reason, "Guard: Token is not support payable by contract.");
        }
    })


    it("set up wrong data", async () => {
        try {
            await revenuePool.setup(
                tally,
                accounts[9], accounts[4],
                spendToken.address,
                [daicpxdToken.address]
            );
            await revenuePool.registerMerchant(lw.accounts[4], offchainId, {
                from: tally
            });
            assert.ok(false);
        } catch (err) {
            assert.ok(true);
        }
    })
})
