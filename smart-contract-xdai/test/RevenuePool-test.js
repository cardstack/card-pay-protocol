const ERC677Token = artifacts.require("ERC677Token.sol");
const RevenuePool = artifacts.require("RevenuePool.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");

const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");

const { expect, TOKEN_DETAIL_DATA } = require("./setup");

const { toTokenUnit, shouldBeSameBalance } = require("./utils/helper");

contract("RevenuePool", (accounts) => {
  let daicpxdToken, revenuePool, spendToken, fakeToken;
  let lw, tally, merchant;
  let offchainId;
  let proxyFactory, gnosisSafeMasterCopy;

  before(async () => {
    offchainId = "offchain";
    lw = await utils.createLightwallet();
    tally = accounts[0];

    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await utils.deployContract(
      "deploying Gnosis Safe Mastercopy",
      GnosisSafe
    );

    revenuePool = await RevenuePool.new();

    // deploy and mint 100 daicpxd token for deployer as owner
    daicpxdToken = await ERC677Token.new(...TOKEN_DETAIL_DATA);
    await daicpxdToken.mint(accounts[0], toTokenUnit(100));

    fakeToken = await ERC677Token.new(...TOKEN_DETAIL_DATA);
    await fakeToken.mint(accounts[0], toTokenUnit(100));
  });

  describe("initial revenue pool contract", () => {
    beforeEach(async () => {
      // deploy spend token
      spendToken = await SPEND.new("SPEND Token", "SPEND", [
        revenuePool.address,
      ]);
      // setup for revenue pool
      await revenuePool.setup(
        tally,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address]
      );
    });

    it("check Revenue pool parameters", async () => {
      expect(await revenuePool.gnosisSafe()).to.equal(
        gnosisSafeMasterCopy.address
      );
      expect(await revenuePool.gnosisProxyFactory()).to.equal(
        proxyFactory.address
      );
      expect(await revenuePool.spendToken()).to.equal(spendToken.address);
      expect(await revenuePool.getTokens()).to.deep.equal([
        daicpxdToken.address,
      ]);
      expect(await revenuePool.getTallys()).to.deep.equal([tally]);
    });

    it("check SPEND token parameters", async () => {
      expect(await spendToken.getMinters()).to.deep.equal([
        revenuePool.address,
      ]);
    });
  });

  describe("create merchant", () => {
    it("can register a merchant from tally", async () => {
      let tx = await revenuePool.registerMerchant(lw.accounts[0], offchainId, {
        from: tally,
      }).should.be.fulfilled;
      let merchantCreation = await utils.getParamsFromEvent(
        tx,
        eventABIs.MERCHANT_CREATION,
        revenuePool.address
      );
      merchant = merchantCreation[0]["merchant"];
      await revenuePool.isMerchant(merchant).should.become(true);
    });

    it("should reject when the merchant address is zero", async () => {
      await revenuePool
        .registerMerchant(utils.ZERO_ADDRESS, offchainId, {
          from: tally,
        })
        .should.be.rejectedWith(
          Error,
          "Merchant address shouldn't zero address"
        );
    });

    it("should reject when a non-tally address tries to register a merchant", async () => {
      await revenuePool
        .registerMerchant(lw.accounts[0], offchainId, {
          from: accounts[2],
        })
        .should.be.rejectedWith(Error, "Tally: caller is not the tally");
    });

    it("set up wrong data", async () => {
      await revenuePool.setup(
        tally,
        accounts[9],
        accounts[4],
        spendToken.address,
        [daicpxdToken.address]
      );

      await revenuePool.registerMerchant(lw.accounts[4], offchainId, {
        from: tally,
      }).should.be.rejected;
    });
  });

  describe("pay token", () => {
    it("can pay 1 DAI CPXD token to pool and mint SPEND token to the merchant's wallet", async () => {
      let amount = toTokenUnit(1);
      let data = web3.eth.abi.encodeParameters(["address"], [merchant]);

      await daicpxdToken.transferAndCall(revenuePool.address, amount, data)
        .should.be.fulfilled;

      await shouldBeSameBalance(daicpxdToken, accounts[0], toTokenUnit(99));
      await shouldBeSameBalance(spendToken, merchant, "100");
    });

    it("can pay 2 DAI CPXD token to pool and mint SPEND token to the merchant's wallet", async () => {
      let amount = toTokenUnit(2); // equal 2 * 10^18
      let data = web3.eth.abi.encodeParameters(["address"], [merchant]);

      await shouldBeSameBalance(spendToken, merchant, "100");
      await daicpxdToken.transferAndCall(revenuePool.address, amount, data);

      await shouldBeSameBalance(daicpxdToken, accounts[0], toTokenUnit(97));
      await shouldBeSameBalance(spendToken, merchant, "300");
    });

    it("should reject if the recipient's address is not a registered merchant", async () => {
      let balanceBefore = await daicpxdToken.balanceOf(accounts[0]);
      //lw.accounts[1] is not merchant.
      let data = web3.eth.abi.encodeParameters(["address"], [lw.accounts[1]]);
      let amount = toTokenUnit(1); // 1 DAI CPXD

      await daicpxdToken
        .transferAndCall(revenuePool.address, amount, data)
        .should.be.rejectedWith(Error, "Invalid merchant");

      await shouldBeSameBalance(daicpxdToken, accounts[0], balanceBefore);
    });

    it("should reject a direct call to onTokenTransfer from a non-token contract", async () => {
      await revenuePool.onTokenTransfer(accounts[0], 100, "0x").should.be
        .rejected;
    });

    it("should reject the receipt of tokens from a non-approved token contract", async () => {
      let amount = toTokenUnit("1"); // equal 1 * 10^18
      let data = web3.eth.abi.encodeParameter("address", lw.accounts[0]);

      await fakeToken
        .transferAndCall(revenuePool.address, amount, data)
        .should.be.rejectedWith(
          Error,
          "Guard: Token is not support payable by contract."
        );
    });
  });

  describe("claim token", () => {
    it("allows a SPEND claim issued from tally (1 DAI CPXD)", async () => {
      let amount = toTokenUnit(1);

      await revenuePool.claimToken(merchant, daicpxdToken.address, amount, {
        from: tally,
      }).should.be.fulfilled;

      await shouldBeSameBalance(daicpxdToken, merchant, toTokenUnit(1));
      await shouldBeSameBalance(spendToken, merchant, "300");
    });

    it("rejects a claim with malformed data", async () => {
      await revenuePool.claimToken(merchant, daicpxdToken.address, [], {
        from: tally,
      }).should.be.rejected;
    });

    it("rejects a claim that is not issued from tally", async () => {
      let amount = toTokenUnit(1);
      await revenuePool.claimToken(merchant, daicpxdToken.address, amount, {
        from: accounts[2],
      }).should.be.rejected;
    });

    // The tests are stateful. At this point the merchant as redeemed 100 of the
    // 300 SPEND tokens they have accumulated, leaving 200 more SPEND that is
    // available to be redeemed.
    it("rejects a claim that is larger than the amount permissable for the merchant", async () => {
      let amount = toTokenUnit(3);
      await revenuePool.claimToken(merchant, daicpxdToken.address, amount, {
        from: tally,
      }).should.be.rejected;
    });
  });
});
