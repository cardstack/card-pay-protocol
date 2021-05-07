const ERC677Token = artifacts.require("ERC677Token.sol");
const RevenuePool = artifacts.require("RevenuePool.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const Feed = artifacts.require("ManualFeed");
const ChainlinkOracle = artifacts.require("ChainlinkFeedAdapter");
const MockDIAOracle = artifacts.require("MockDIAOracle");
const DIAPriceOracle = artifacts.require("DIAOracleAdapter");

const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");

const { expect, TOKEN_DETAIL_DATA } = require("./setup");
const { BN, fromWei } = require("web3").utils;

const {
  toTokenUnit,
  shouldBeSameBalance,
  getBalance,
} = require("./utils/helper");

contract("RevenuePool", (accounts) => {
  let daicpxdToken,
    revenuePool,
    spendToken,
    fakeToken,
    lw,
    tally,
    feed,
    daiOracle,
    cardOracle,
    owner,
    merchant,
    anotherMerchant,
    merchantSafe,
    offchainId,
    proxyFactory,
    gnosisSafeMasterCopy;

  before(async () => {
    offchainId = "offchain";
    lw = await utils.createLightwallet();
    owner = accounts[0];
    tally = accounts[1];
    merchant = accounts[2];
    anotherMerchant = accounts[3];

    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await utils.deployContract(
      "deploying Gnosis Safe Mastercopy",
      GnosisSafe
    );

    revenuePool = await RevenuePool.new();
    await revenuePool.initialize(owner);

    // deploy and mint 100 daicpxd token for deployer as owner
    daicpxdToken = await ERC677Token.new();
    await daicpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await daicpxdToken.mint(owner, toTokenUnit(100));

    fakeToken = await ERC677Token.new();
    await fakeToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await fakeToken.mint(owner, toTokenUnit(100));

    feed = await Feed.new();
    await feed.initialize(owner);
    await feed.setup("DAI.CPXD", 8);
    await feed.addRound(100000000, 1618433281, 1618433281);
    let ethFeed = await Feed.new();
    await ethFeed.initialize(owner);
    await ethFeed.setup("ETH", 8);
    await ethFeed.addRound(300000000000, 1618433281, 1618433281);

    daiOracle = await ChainlinkOracle.new();
    daiOracle.initialize(owner);
    await daiOracle.setup(feed.address, ethFeed.address);

    let mockDiaOracle = await MockDIAOracle.new();
    await mockDiaOracle.initialize(owner);
    await mockDiaOracle.setValue("CARD/USD", 1000000, 1618433281);
    cardOracle = await DIAPriceOracle.new();
    await cardOracle.initialize(owner);
    await cardOracle.setup(mockDiaOracle.address, "CARD");

    await revenuePool.createExchange("DAI", daiOracle.address);
    await revenuePool.createExchange("CARD", cardOracle.address);
  });

  describe("initial revenue pool contract", () => {
    beforeEach(async () => {
      // deploy spend token
      spendToken = await SPEND.new();
      await spendToken.initialize(owner, revenuePool.address);

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
    // Warning the merchant safe created in this test is used in all the
    // subsequent tests!
    it("can register a merchant from tally", async () => {
      let tx = await revenuePool.registerMerchant(merchant, offchainId, {
        from: tally,
      }).should.be.fulfilled;
      let merchantCreation = await utils.getParamsFromEvent(
        tx,
        eventABIs.MERCHANT_CREATION,
        revenuePool.address
      );
      merchantSafe = merchantCreation[0]["merchantSafe"];
      await revenuePool.isMerchantSafe(merchantSafe).should.become(true);
    });

    it("can register a merchant from owner", async () => {
      let tx = await revenuePool.registerMerchant(anotherMerchant, offchainId, {
        from: owner,
      }).should.be.fulfilled;
      let merchantCreation = await utils.getParamsFromEvent(
        tx,
        eventABIs.MERCHANT_CREATION,
        revenuePool.address
      );
      let safe = merchantCreation[0]["merchantSafe"];
      await revenuePool.isMerchantSafe(safe).should.become(true);
    });

    it("can return an already created safe for a merchant if they are already registered", async () => {
      await revenuePool.isMerchantSafe(merchantSafe).should.become(true);
      let tx = await revenuePool.registerMerchant(merchant, offchainId);
      let merchantUpdate = await utils.getParamsFromEvent(
        tx,
        eventABIs.MERCHANT_UPDATE,
        revenuePool.address
      );
      let existingSafe = merchantUpdate[0]["merchantSafe"];
      expect(existingSafe).to.equal(merchantSafe);
    });

    it("should reject when the merchant address is zero", async () => {
      await revenuePool
        .registerMerchant(utils.ZERO_ADDRESS, offchainId, {
          from: tally,
        })
        .should.be.rejectedWith(Error, "zero address not allowed");
    });

    it("should reject when a non-tally address tries to register a merchant", async () => {
      await revenuePool
        .registerMerchant(accounts[9], offchainId, {
          from: merchant,
        })
        .should.be.rejectedWith(Error, "caller is not tally or owner");
    });

    it("set up with incorrect gnosis master copy and factory", async () => {
      await revenuePool.setup(
        tally,
        accounts[9],
        accounts[4],
        spendToken.address,
        [daicpxdToken.address]
      );

      await revenuePool.registerMerchant(accounts[4], offchainId, {
        from: tally,
      }).should.be.rejected;
    });
  });

  describe("pay token", () => {
    it("can pay 1 DAI CPXD token to pool and mint SPEND token to the merchant's wallet", async () => {
      let existingSPENDBalance = Number(
        BN(await getBalance(spendToken, merchantSafe)).toString()
      );
      let existingDAIBalance = fromWei(
        BN(await getBalance(daicpxdToken, owner)).toString()
      );
      let amount = toTokenUnit(1);
      let data = web3.eth.abi.encodeParameters(["address"], [merchantSafe]);

      await daicpxdToken.transferAndCall(revenuePool.address, amount, data)
        .should.be.fulfilled;

      await shouldBeSameBalance(
        daicpxdToken,
        owner,
        toTokenUnit(existingDAIBalance - 1)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        String(existingSPENDBalance + 100)
      );
    });

    it("can pay 2 DAI CPXD token to pool and mint SPEND token to the merchant's wallet", async () => {
      let existingSPENDBalance = Number(
        BN(await getBalance(spendToken, merchantSafe)).toString()
      );
      let existingDAIBalance = fromWei(
        BN(await getBalance(daicpxdToken, owner)).toString()
      );
      let amount = toTokenUnit(2); // equal 2 * 10^18
      let data = web3.eth.abi.encodeParameters(["address"], [merchantSafe]);

      await daicpxdToken.transferAndCall(revenuePool.address, amount, data);

      await shouldBeSameBalance(
        daicpxdToken,
        owner,
        toTokenUnit(existingDAIBalance - 2)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        String(existingSPENDBalance + 200)
      );
    });

    it("should reject if the recipient's address is not a registered merchant", async () => {
      let existingSPENDBalance = await daicpxdToken.balanceOf(owner);
      let existingDAIBalance = fromWei(
        BN(await getBalance(daicpxdToken, owner)).toString()
      );
      //lw.accounts[1] is not merchant.
      let data = web3.eth.abi.encodeParameters(["address"], [lw.accounts[1]]);
      let amount = toTokenUnit(1); // 1 DAI CPXD

      await daicpxdToken
        .transferAndCall(revenuePool.address, amount, data)
        .should.be.rejectedWith(Error, "Invalid merchant");

      await shouldBeSameBalance(daicpxdToken, owner, existingSPENDBalance);
      await shouldBeSameBalance(
        daicpxdToken,
        owner,
        toTokenUnit(existingDAIBalance)
      );
    });

    it("should reject a direct call to onTokenTransfer from a non-token contract", async () => {
      await revenuePool.onTokenTransfer(owner, 100, "0x").should.be.rejected;
    });

    it("should reject the receipt of tokens from a non-approved token contract", async () => {
      let amount = toTokenUnit("1"); // equal 1 * 10^18
      let data = web3.eth.abi.encodeParameter("address", lw.accounts[0]);

      await fakeToken
        .transferAndCall(revenuePool.address, amount, data)
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });
  });

  describe("exchange rate", () => {
    afterEach(async () => {
      // reset the rate to 1:1
      await feed.addRound(100000000, 1618435000, 1618435000);
    });

    it("can convert an amount of CARD to the specified token", async () => {
      // The configured rate is 1 DAI : 100 CARD
      let amount = await revenuePool.convertFromCARD(
        daicpxdToken.address,
        toTokenUnit(100)
      );
      expect(fromWei(amount)).to.equal("1");
    });

    it("can convert a token amount to SPEND", async () => {
      // The configured rate is 1^18 DAI : 100 SPEND
      let amount = await revenuePool.convertToSpend(
        daicpxdToken.address,
        toTokenUnit(1)
      );
      expect(amount.toString()).to.equal("100");
    });

    it("can convert a SPEND amount to a token", async () => {
      // The configured rate is 1^18 DAI : 100 SPEND
      let amount = await revenuePool.convertFromSpend(
        daicpxdToken.address,
        100
      );
      expect(fromWei(amount)).to.equal("1");
    });

    it("rejects when converting from CARD and no CARD exchange has been added", async () => {
      let badPool = await RevenuePool.new();
      await badPool.initialize(owner);
      await badPool.setup(
        tally,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address]
      );
      await badPool.createExchange("DAI", daiOracle.address);

      await badPool
        .convertFromCARD(daicpxdToken.address, toTokenUnit(100))
        .should.be.rejectedWith(Error, "no exchange exists for CARD");
    });

    it("rejects when converting from CARD and no exchange has been added for desired token", async () => {
      let badPool = await RevenuePool.new();
      await badPool.initialize(owner);
      await badPool.setup(
        tally,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address]
      );
      await badPool.createExchange("CARD", cardOracle.address);

      await badPool
        .convertFromCARD(daicpxdToken.address, toTokenUnit(100))
        .should.be.rejectedWith(Error, "no exchange exists for token");
    });

    it("when exchange rate is 2:1, a payment of 1 DAI token results in 200 SPEND tokens minted in merchant's wallet", async () => {
      let existingSPENDBalance = Number(
        BN(await getBalance(spendToken, merchantSafe)).toString()
      );
      let existingDAIBalance = fromWei(
        BN(await getBalance(daicpxdToken, owner)).toString()
      );
      await feed.addRound(200000000, 1618435000, 1618435000);
      let amount = toTokenUnit(1);
      let data = web3.eth.abi.encodeParameters(["address"], [merchantSafe]);

      await daicpxdToken.transferAndCall(revenuePool.address, amount, data)
        .should.be.fulfilled;

      await shouldBeSameBalance(
        daicpxdToken,
        owner,
        toTokenUnit(existingDAIBalance - 1)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        String(existingSPENDBalance + 200)
      );
    });

    it("when exchange rate is 1:2, a payment of 1 DAI token results in 50 SPEND tokens minted in merchant's wallet", async () => {
      let existingSPENDBalance = Number(
        BN(await getBalance(spendToken, merchantSafe)).toString()
      );
      let existingDAIBalance = fromWei(
        BN(await getBalance(daicpxdToken, owner)).toString()
      );
      await feed.addRound(50000000, 1618436000, 1618436000);
      let amount = toTokenUnit(1);
      let data = web3.eth.abi.encodeParameters(["address"], [merchantSafe]);

      await daicpxdToken.transferAndCall(revenuePool.address, amount, data)
        .should.be.fulfilled;

      await shouldBeSameBalance(
        daicpxdToken,
        owner,
        toTokenUnit(existingDAIBalance - 1)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        String(existingSPENDBalance + 50)
      );
    });

    it("rejects when exchange rate is 0", async () => {
      let existingSPENDBalance = await daicpxdToken.balanceOf(owner);
      let existingDAIBalance = fromWei(
        BN(await getBalance(daicpxdToken, owner)).toString()
      );
      await feed.addRound(0, 1618436000, 1618436000);
      let data = web3.eth.abi.encodeParameters(["address"], [merchantSafe]);
      let amount = toTokenUnit(1);

      await daicpxdToken
        .transferAndCall(revenuePool.address, amount, data)
        .should.be.rejectedWith(Error, "exchange rate cannot be 0");

      await shouldBeSameBalance(daicpxdToken, owner, existingSPENDBalance);
      await shouldBeSameBalance(
        daicpxdToken,
        owner,
        toTokenUnit(existingDAIBalance)
      );
    });
  });

  describe("claim token", () => {
    it("allows a SPEND claim issued from tally (1 DAI CPXD)", async () => {
      let amount = toTokenUnit(1);
      let existingSPENDBalance = Number(
        BN(await getBalance(spendToken, merchantSafe)).toString()
      );
      let existingDAIBalance = fromWei(
        BN(await getBalance(daicpxdToken, merchantSafe)).toString()
      );
      await revenuePool.claimToken(merchantSafe, daicpxdToken.address, amount, {
        from: tally,
      }).should.be.fulfilled;

      await shouldBeSameBalance(
        daicpxdToken,
        merchantSafe,
        toTokenUnit(existingDAIBalance + 1)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        String(existingSPENDBalance)
      );
    });

    it("rejects a claim with malformed data", async () => {
      await revenuePool.claimToken(merchantSafe, daicpxdToken.address, [], {
        from: tally,
      }).should.be.rejected;
    });

    it("rejects a claim that is not issued from tally", async () => {
      let amount = toTokenUnit(1);
      await revenuePool.claimToken(merchantSafe, daicpxdToken.address, amount, {
        from: accounts[2],
      }).should.be.rejected;
    });

    // The tests are stateful. At this point the merchant as redeemed 100 of the
    // SPEND tokens they have accumulated.
    it("rejects a claim that is larger than the amount permissable for the merchant", async () => {
      let invalidAmount = Math.ceil(
        Number(BN(await getBalance(spendToken, merchantSafe)).toString()) / 100
      );
      let amount = toTokenUnit(invalidAmount);
      await revenuePool.claimToken(merchantSafe, daicpxdToken.address, amount, {
        from: tally,
      }).should.be.rejected;
    });
  });

  describe("roles", () => {
    it("can create and remove a tally role", async () => {
      let newTally = accounts[8];
      await revenuePool.removeTally(tally).should.be.fulfilled;
      await revenuePool.addTally(newTally).should.be.fulfilled;

      await revenuePool.getTallys().should.become([newTally]);
    });

    it("can add and remove a payable token", async () => {
      let mockPayableTokenAddr = accounts[9];

      await revenuePool.addPayableToken(mockPayableTokenAddr).should.be
        .fulfilled;

      await revenuePool.removePayableToken(daicpxdToken.address).should.be
        .fulfilled;

      await revenuePool.getTokens().should.become([mockPayableTokenAddr]);
    });
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await revenuePool.cardProtocolVersion()).to.match(/\d\.\d\.\d/);
    });
  });
});
