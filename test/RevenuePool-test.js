const ERC677Token = artifacts.require("ERC677Token.sol");
const RevenuePool = artifacts.require("RevenuePool.sol");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const BridgeUtils = artifacts.require("BridgeUtils");

const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");

const { ZERO_ADDRESS, getParamsFromEvent } = utils;
const { expect, TOKEN_DETAIL_DATA } = require("./setup");
const { BN, fromWei, toBN, toWei } = require("web3").utils;

const {
  toTokenUnit,
  shouldBeSameBalance,
  getBalance,
  signAndSendSafeTransaction,
  setupExchanges,
  createDepotFromBridgeUtils,
  createPrepaidCards,
  registerMerchant,
  transferOwner,
  payMerchant,
} = require("./utils/helper");

contract("RevenuePool", (accounts) => {
  let daicpxdToken,
    cardcpxdToken,
    revenuePool,
    spendToken,
    fakeToken,
    issuer,
    daiFeed,
    daiOracle,
    cardOracle,
    owner,
    relayer,
    merchant,
    customer,
    merchantSafe,
    merchantFeeReceiver,
    proxyFactory,
    gnosisSafeMasterCopy,
    prepaidCardManager,
    bridgeUtils,
    depot;

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    merchant = accounts[2];
    customer = accounts[3];
    relayer = accounts[5];
    merchantFeeReceiver = accounts[6];

    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await utils.deployContract(
      "deploying Gnosis Safe Mastercopy",
      GnosisSafe
    );

    revenuePool = await RevenuePool.new();
    await revenuePool.initialize(owner);
    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);
    bridgeUtils = await BridgeUtils.new();
    await bridgeUtils.initialize(owner);
    spendToken = await SPEND.new();
    await spendToken.initialize(owner);

    ({
      daiFeed,
      daicpxdToken,
      cardcpxdToken,
      chainlinkOracle: daiOracle,
      diaPriceOracle: cardOracle,
    } = await setupExchanges(owner));

    await daicpxdToken.mint(owner, toTokenUnit(100));
    fakeToken = await ERC677Token.new();
    await fakeToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await fakeToken.mint(owner, toTokenUnit(100));

    await revenuePool.createExchange("DAI", daiOracle.address);
    await revenuePool.createExchange("CARD", cardOracle.address);

    await bridgeUtils.setup(
      revenuePool.address,
      prepaidCardManager.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      owner
    );

    await prepaidCardManager.setup(
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      revenuePool.address,
      ZERO_ADDRESS,
      0,
      [daicpxdToken.address, cardcpxdToken.address],
      cardcpxdToken.address,
      100,
      500000
    );

    await spendToken.addMinter(revenuePool.address);
    depot = await createDepotFromBridgeUtils(bridgeUtils, owner, issuer);
    await daicpxdToken.mint(depot.address, toTokenUnit(1000));
  });

  describe("initial revenue pool contract", () => {
    beforeEach(async () => {
      await revenuePool.setup(
        prepaidCardManager.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address],
        merchantFeeReceiver,
        0,
        1000
      );
      await revenuePool.setBridgeUtils(bridgeUtils.address);
    });

    it("reverts when merchantFeeReceiver is set to zero address", async () => {
      await revenuePool
        .setup(
          prepaidCardManager.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          spendToken.address,
          [daicpxdToken.address],
          ZERO_ADDRESS,
          0,
          1000
        )
        .should.be.rejectedWith(Error, "merchantFeeReceiver not set");
    });

    it("reverts when merchantRegistrationFeeInSPEND is not set", async () => {
      await revenuePool
        .setup(
          prepaidCardManager.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          spendToken.address,
          [daicpxdToken.address],
          merchantFeeReceiver,
          0,
          0
        )
        .should.be.rejectedWith(
          Error,
          "merchantRegistrationFeeInSPEND is not set"
        );
    });

    it("reverts when non-owner calls setup()", async () => {
      await revenuePool
        .setup(
          prepaidCardManager.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          spendToken.address,
          [daicpxdToken.address],
          merchantFeeReceiver,
          0,
          1000,
          { from: merchant }
        )
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
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
      expect(await revenuePool.merchantFeeReceiver()).to.equal(
        merchantFeeReceiver
      );
      expect((await revenuePool.merchantFeePercentage()).toString()).to.equal(
        "0"
      );
      expect(
        (await revenuePool.merchantRegistrationFeeInSPEND()).toString()
      ).to.equal("1000");
      expect(await revenuePool.prepaidCardManager()).to.equal(
        prepaidCardManager.address
      );
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
    it("a merchant uses a prepaid card to register themselves", async () => {
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        merchant,
        relayer
      );
      let merchantTx = await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        merchant,
        toTokenUnit(10)
      );
      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        revenuePool.address
      );
      merchantSafe = merchantCreation[0]["merchantSafe"]; // Warning: this is reused in other tests

      expect(await revenuePool.safeForMerchant(merchant)).to.equal(
        merchantSafe
      );
      expect(await revenuePool.isMerchantSafe(merchantSafe)).to.equal(true);

      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(10))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance.add(toTokenUnit(10))
      );
    });

    it("refunds the prepaid card if the merchant pays more than the registration fee", async () => {
      let _merchant = accounts[9];
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(11)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        _merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        _merchant,
        toTokenUnit(11)
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(10))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance.add(toTokenUnit(10))
      );
    });

    it("merchant registration does not collect the merchantFeePercentage (only the registration fee)", async () => {
      let _merchant = accounts[8];
      await revenuePool.setup(
        prepaidCardManager.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address],
        merchantFeeReceiver,
        10000000,
        1000
      );
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        _merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        _merchant,
        toTokenUnit(10)
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(10))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance.add(toTokenUnit(10))
      );

      // Reset back for the subsequent tests
      await revenuePool.setup(
        prepaidCardManager.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address],
        merchantFeeReceiver,
        0,
        1000
      );
    });

    it("reverts when a merchant doesn't send the registration fee amount", async () => {
      let _merchant = accounts[7];
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        _merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        _merchant,
        toTokenUnit(9)
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance
      );
    });

    it("reverts when a merchant doesn't have enough in their prepaid card for the registration fee amount", async () => {
      let _merchant = accounts[7];
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(9)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        _merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        _merchant,
        toTokenUnit(10)
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance
      );
    });

    it("reverts when a merchant re-registers", async () => {
      // This test assumes that 'merchant' has already been registered in previous test
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        merchant,
        toTokenUnit(10)
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance
      );
    });

    it("reverts when set up with incorrect gnosis master copy and factory", async () => {
      let _merchant = accounts[7];
      await revenuePool.setup(
        prepaidCardManager.address,
        accounts[9],
        accounts[4],
        spendToken.address,
        [daicpxdToken.address],
        merchantFeeReceiver,
        0,
        1000
      );
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        _merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        _merchant,
        toTokenUnit(10)
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );

      // Reset back for the subsequent tests
      await revenuePool.setup(
        prepaidCardManager.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address],
        merchantFeeReceiver,
        0,
        1000
      );
    });
  });

  describe("pay token", () => {
    let prepaidCard;
    before(async () => {
      ({
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(100)]
      ));
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        customer,
        relayer
      );
      await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(1000000));
    });

    it("can pay 1 DAI CPXD token to pool and mint SPEND token to the merchant's wallet", async () => {
      let existingSPENDBalance = await getBalance(spendToken, merchantSafe);
      let existingDAIBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        merchantSafe,
        toTokenUnit(1)
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAIBalance.sub(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingSPENDBalance.add(toBN("100"))
      );
    });

    it("can pay 2 DAI CPXD token to pool and mint SPEND token to the merchant's wallet", async () => {
      let existingSPENDBalance = await getBalance(spendToken, merchantSafe);
      let existingDAIBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        merchantSafe,
        toTokenUnit(2)
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAIBalance.sub(toTokenUnit(2))
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingSPENDBalance.add(toBN("200"))
      );
    });

    it("can collect merchant fees from the customer payment to the merchant", async () => {
      await revenuePool.setup(
        prepaidCardManager.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address],
        merchantFeeReceiver,
        10000000, // 10% merchant fee
        1000
      );
      expect((await revenuePool.merchantFeePercentage()).toString()).to.equal(
        "10000000"
      );

      let beginningMerchantSpendBalance = await getBalance(
        spendToken,
        merchantSafe
      );
      let beginningMerchantDaiClaim = BN(
        await revenuePool.revenueBalance(merchantSafe, daicpxdToken.address)
      );
      let beginningSenderDaiBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let beginningRevenuePoolDaiBalance = await getBalance(
        daicpxdToken,
        revenuePool.address
      );
      let beginningMerchantFeeReceiverDaiBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        merchantSafe,
        toTokenUnit(1)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        beginningMerchantSpendBalance.add(new BN("90"))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        beginningSenderDaiBalance.sub(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        beginningRevenuePoolDaiBalance.add(new BN(toWei("0.9")))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        beginningMerchantFeeReceiverDaiBalance.add(new BN(toWei("0.1")))
      );
      expect(
        (
          await revenuePool.revenueBalance(merchantSafe, daicpxdToken.address)
        ).toString()
      ).to.equal(
        beginningMerchantDaiClaim.add(new BN(toWei("0.9"))).toString()
      );

      // reset state of the pool for the other tests
      await revenuePool.setup(
        prepaidCardManager.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address],
        merchantFeeReceiver,
        0,
        1000
      );
    });

    it("reverts when a non-prepaid card sends tokens", async () => {
      let amount = toTokenUnit(1);
      let data = web3.eth.abi.encodeParameters(["address"], [merchantSafe]);

      await daicpxdToken
        .transferAndCall(revenuePool.address, amount, data)
        .should.be.rejectedWith(Error, "Caller is not a prepaid card");
    });

    it("should reject if the recipient's address is not a registered merchant safe", async () => {
      let existingRecipientSPENDBalance = await daicpxdToken.balanceOf(
        depot.address
      );
      let existingRecipientDaiBalance = await daicpxdToken.balanceOf(
        depot.address
      );
      let existingDAISenderBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );

      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        depot.address, // the depot is not a merchant safe
        toTokenUnit(1)
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );

      await shouldBeSameBalance(
        daicpxdToken,
        depot.address,
        existingRecipientDaiBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        depot.address,
        existingRecipientSPENDBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAISenderBalance
      );
    });

    it("should reject a direct call to onTokenTransfer from a non-token contract", async () => {
      await revenuePool.onTokenTransfer(owner, 100, "0x").should.be.rejected;
    });
  });

  describe("exchange rate", () => {
    let prepaidCard;
    before(async () => {
      ({
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(100)]
      ));
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        customer,
        relayer
      );
      await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(1000000));
    });
    afterEach(async () => {
      // reset the rate to 1:1
      await daiFeed.addRound(100000000, 1618435000, 1618435000);
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
        prepaidCardManager.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address],
        merchantFeeReceiver,
        0,
        1000
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
        prepaidCardManager.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        spendToken.address,
        [daicpxdToken.address],
        merchantFeeReceiver,
        0,
        1000
      );
      await badPool.createExchange("CARD", cardOracle.address);

      await badPool
        .convertFromCARD(daicpxdToken.address, toTokenUnit(100))
        .should.be.rejectedWith(Error, "no exchange exists for token");
    });

    it("when exchange rate is 2:1, a payment of 1 DAI token results in 200 SPEND tokens minted in merchant's wallet", async () => {
      let existingSPENDBalance = await getBalance(spendToken, merchantSafe);
      let existingDAIBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      await daiFeed.addRound(200000000, 1618435000, 1618435000);
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        merchantSafe,
        toTokenUnit(1)
      );

      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAIBalance.sub(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingSPENDBalance.add(toBN("200"))
      );
    });

    it("when exchange rate is 1:2, a payment of 1 DAI token results in 50 SPEND tokens minted in merchant's wallet", async () => {
      let existingSPENDBalance = await getBalance(spendToken, merchantSafe);
      let existingDAIBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      await daiFeed.addRound(50000000, 1618436000, 1618436000);
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        merchantSafe,
        toTokenUnit(1)
      );

      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAIBalance.sub(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingSPENDBalance.add(toBN("50"))
      );
    });

    it("rejects when exchange rate is 0", async () => {
      let existingSPENDBalance = await spendToken.balanceOf(merchantSafe);
      let existingDAIBalance = await daicpxdToken.balanceOf(
        prepaidCard.address
      );
      await daiFeed.addRound(0, 1618436000, 1618436000);
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        merchantSafe,
        toTokenUnit(1)
      ).should.be.rejectedWith(Error, "exchange rate cannot be 0");

      await shouldBeSameBalance(spendToken, merchantSafe, existingSPENDBalance);
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAIBalance
      );
    });
  });

  describe("claim token", () => {
    it("can get the tokens for which the merchant has received revenue", async () => {
      let tokens = await revenuePool.revenueTokens(merchantSafe);
      expect(tokens).to.deep.equal([daicpxdToken.address]);
    });

    it("can get the merchants revenue balance for a payment token", async () => {
      let balance = await revenuePool.revenueBalance(
        merchantSafe,
        daicpxdToken.address
      );
      // The tests are stateful at this point the merchant has accumulated 5.9 DAI
      // of customer payments
      expect(balance.toString()).to.equal(toWei("5.9"));
    });

    it("allows a revenue claim issued from a merchant's safe (1 DAI CPXD)", async () => {
      let amount = toTokenUnit(1);
      let existingSPENDBalance = Number(
        BN(await getBalance(spendToken, merchantSafe)).toString()
      );
      let existingDAIBalance = fromWei(
        BN(await getBalance(daicpxdToken, merchantSafe)).toString()
      );

      let claimRevenue = revenuePool.contract.methods.claimRevenue(
        daicpxdToken.address,
        amount
      );
      let payload = claimRevenue.encodeABI();
      let gasEstimate = await claimRevenue.estimateGas({ from: merchantSafe });
      let safeTxData = {
        to: revenuePool.address,
        data: payload,
        txGasEstimate: gasEstimate,
        gasPrice: 1000000000,
        txGasToken: daicpxdToken.address,
        refundReceive: relayer,
      };
      let merchantSafeContract = await GnosisSafe.at(merchantSafe);
      let { safeTx } = await signAndSendSafeTransaction(
        safeTxData,
        merchant,
        merchantSafeContract,
        relayer
      );
      let executeSuccess = utils.getParamsFromEvent(
        safeTx,
        eventABIs.EXECUTION_SUCCESS,
        merchantSafe
      );
      let gasFee = toBN(executeSuccess[0]["payment"]);

      await shouldBeSameBalance(
        daicpxdToken,
        merchantSafe,
        toTokenUnit(existingDAIBalance + 1).sub(gasFee)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        String(existingSPENDBalance)
      );
    });

    it("rejects a claim that is not issued from merchant's safe", async () => {
      let amount = toTokenUnit(1);
      await revenuePool
        .claimRevenue(daicpxdToken.address, amount, {
          from: merchant,
        })
        .should.be.rejectedWith(Error, "caller is not a merchant safe");
    });

    it("rejects a claim that is larger than the amount permissable for the merchant", async () => {
      let currentBalance = await revenuePool.revenueBalance(
        merchantSafe,
        daicpxdToken.address
      );
      let invalidAmount = currentBalance.add(new BN("100"));
      let claimRevenue = revenuePool.contract.methods.claimRevenue(
        daicpxdToken.address,
        invalidAmount
      );
      // reverts are trigged via the gas estimation, so we'll never get far
      // enough to actually issue the execTransaction on the safe
      await claimRevenue
        .estimateGas({ from: merchantSafe })
        .should.be.rejectedWith(Error, "Insufficient funds");
    });
  });

  describe("roles", () => {
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
      expect(await revenuePool.cardpayVersion()).to.match(/\d\.\d\.\d/);
    });
  });
});
