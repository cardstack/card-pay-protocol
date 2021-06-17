const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const ERC677Token = artifacts.require("ERC677Token.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const BridgeUtils = artifacts.require("BridgeUtils");
const RewardPool = artifacts.require("RewardPool.sol");

const eventABIs = require("./utils/constant/eventABIs");

const {
  signSafeTransaction,
  ZERO_ADDRESS,
  getParamsFromEvent,
  getGnosisSafeFromEventLog,
} = require("./utils/general");

const {
  toTokenUnit,
  shouldBeSameBalance,
  encodeCreateCardsData,
  signAndSendSafeTransaction,
  getBalance,
  setupExchanges,
  createPrepaidCards,
  registerMerchant,
  payMerchant,
  transferOwner,
  packExecutionData,
  createDepotFromBridgeUtils,
  addHandlersToRevenuePool,
} = require("./utils/helper");

const { expect, TOKEN_DETAIL_DATA, toBN } = require("./setup");

contract("PrepaidCardManager", (accounts) => {
  let MINIMUM_AMOUNT,
    MAXIMUM_AMOUNT,
    revenuePool,
    spendToken,
    prepaidCardManager,
    merchant,
    daicpxdToken,
    cardcpxdToken,
    fakeDaicpxdToken,
    gnosisSafeMasterCopy,
    proxyFactory,
    exchange,
    payMerchantHandler,
    owner,
    issuer,
    customer,
    gasFeeReceiver,
    merchantFeeReceiver,
    merchantSafe,
    relayer,
    depot,
    prepaidCards = [],
    rewardPool;

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    customer = accounts[2];
    merchant = accounts[3];
    relayer = accounts[4];
    gasFeeReceiver = accounts[5];
    merchantFeeReceiver = accounts[6];

    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await GnosisSafe.new();
    revenuePool = await RevenuePool.new();
    await revenuePool.initialize(owner);
    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);
    let bridgeUtils = await BridgeUtils.new();
    await bridgeUtils.initialize(owner);
    rewardPool = await RewardPool.new();
    await rewardPool.initialize(owner);

    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));
    // Deploy and mint 1000 daicpxd token for deployer as owner
    await daicpxdToken.mint(owner, toTokenUnit(1000));

    // Deploy and mint 1000 fake daicpxd token for deployer as owner
    fakeDaicpxdToken = await ERC677Token.new();
    await fakeDaicpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await fakeDaicpxdToken.mint(owner, toTokenUnit(1000));

    // create spendToken
    spendToken = await SPEND.new();
    await spendToken.initialize(owner);

    await revenuePool.setup(
      exchange.address,
      prepaidCardManager.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      [daicpxdToken.address],
      merchantFeeReceiver,
      0,
      1000
    );
    ({ payMerchantHandler } = await addHandlersToRevenuePool(
      revenuePool,
      owner,
      exchange.address,
      spendToken.address
    ));
    await spendToken.addMinter(payMerchantHandler.address);

    await bridgeUtils.setup(
      exchange.address,
      revenuePool.address,
      prepaidCardManager.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      owner,
      rewardPool.address
    );
    await revenuePool.setBridgeUtils(bridgeUtils.address);
    await prepaidCardManager.setBridgeUtils(bridgeUtils.address);
    await rewardPool.setBridgeUtils(bridgeUtils.address);
    depot = await createDepotFromBridgeUtils(bridgeUtils, owner, issuer);

    MINIMUM_AMOUNT = 100; // in spend <=> 1 USD
    MAXIMUM_AMOUNT = 500000; // in spend <=>  5000 USD
  });

  describe("setup contract", () => {
    before(async () => {
      // Setup card manager contract
      await prepaidCardManager.setup(
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        revenuePool.address,
        gasFeeReceiver,
        0,
        [daicpxdToken.address, cardcpxdToken.address],
        cardcpxdToken.address,
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT
      );
    });

    it("should initialize parameters", async () => {
      expect(await prepaidCardManager.gnosisSafe()).to.equal(
        gnosisSafeMasterCopy.address
      );
      expect(await prepaidCardManager.gnosisProxyFactory()).to.equal(
        proxyFactory.address
      );
      expect(await prepaidCardManager.revenuePool()).to.deep.equal(
        revenuePool.address
      );
      expect(await prepaidCardManager.getTokens()).to.deep.equal([
        daicpxdToken.address,
        cardcpxdToken.address,
      ]);
      expect(await prepaidCardManager.minimumFaceValue()).to.a.bignumber.equal(
        toBN(MINIMUM_AMOUNT)
      );
      expect(await prepaidCardManager.maximumFaceValue()).to.a.bignumber.equal(
        toBN(MAXIMUM_AMOUNT)
      );
      expect(await prepaidCardManager.gasToken()).to.equal(
        cardcpxdToken.address
      );
    });
  });

  describe("create prepaid card", () => {
    let walletAmount;

    before(() => {
      walletAmount = toTokenUnit(1000);
    });

    beforeEach(async () => {
      // mint 100 token for depot
      await daicpxdToken.mint(depot.address, walletAmount);
    });

    afterEach(async () => {
      // burn all token in depot wallet
      let balance = await daicpxdToken.balanceOf(depot.address);
      let data = daicpxdToken.contract.methods.burn(balance).encodeABI();

      let safeTxData = {
        to: daicpxdToken.address,
        data,
      };

      await signAndSendSafeTransaction(safeTxData, issuer, depot, relayer);

      // burn all token in relayer wallet
      await daicpxdToken.burn(await daicpxdToken.balanceOf(relayer), {
        from: relayer,
      });
    });

    it("should create prepaid card when balance is 1 token", async () => {
      let amount = toTokenUnit(1);
      let {
        prepaidCards,
        paymentActual,
        executionSucceeded,
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [amount]
      );

      expect(executionSucceeded).to.equal(true);
      await shouldBeSameBalance(daicpxdToken, relayer, paymentActual);

      expect(prepaidCards).to.have.lengthOf(1);

      await prepaidCards[0].isOwner(issuer).should.become(true);

      await prepaidCardManager
        .cardDetails(prepaidCards[0].address)
        .should.eventually.to.include({
          issuer,
          issueToken: daicpxdToken.address,
          customizationDID: "",
        });

      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCards[0].address,
        toTokenUnit(1)
      );
      await shouldBeSameBalance(
        daicpxdToken,
        depot.address,
        walletAmount.sub(toTokenUnit(1)).sub(paymentActual)
      );
    });

    it("should create prepaid card with customization DID", async () => {
      let amount = toTokenUnit(1);
      let { prepaidCards, executionSucceeded } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [amount],
        undefined,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
      );

      expect(executionSucceeded).to.equal(true);

      await prepaidCardManager
        .cardDetails(prepaidCards[0].address)
        .should.eventually.to.include({
          issuer,
          issueToken: daicpxdToken.address,
          customizationDID:
            "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49",
        });
    });

    // Note that these prepaid cards are used in the subsequent tests:
    //   prepaidCards[0] = 1 daicpxd,
    //   prepaidCards[1] = 2 daicpxd,
    //   prepaidCards[2] = 5 daicpxd
    // TODO refactor our tests to be less stateful
    it("should create multi Prepaid Card (1 daicpxd 2 daicpxd 5 daicpxd) ", async () => {
      let amounts = [1, 2, 5].map((amount) => toTokenUnit(amount));
      let paymentActual;
      let executionSucceeded;

      ({
        prepaidCards, // Careful!! this variable is used in other tests!!
        paymentActual,
        executionSucceeded,
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        amounts
      ));

      expect(executionSucceeded).to.equal(true);
      expect(prepaidCards).to.have.lengthOf(
        3,
        "Should create a new 3 cards(gnosis safe)."
      );

      prepaidCards.forEach(async (prepaidCard, index) => {
        await prepaidCardManager
          .cardDetails(prepaidCard.address)
          .should.eventually.to.include({
            issuer,
            issueToken: daicpxdToken.address,
            customizationDID: "",
          });

        await prepaidCard.isOwner(issuer).should.become(true);
        await prepaidCard
          .isOwner(prepaidCardManager.address)
          .should.become(true);

        shouldBeSameBalance(daicpxdToken, prepaidCard.address, amounts[index]);
      });

      await shouldBeSameBalance(
        daicpxdToken,
        depot.address,
        walletAmount.sub(toTokenUnit(8)).sub(paymentActual)
      );

      await shouldBeSameBalance(daicpxdToken, relayer, paymentActual);
    });

    it("should create multi Prepaid Cards with the same customization DID ", async () => {
      let amounts = [1, 2, 5].map((amount) => toTokenUnit(amount));
      let { prepaidCards, executionSucceeded } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        amounts,
        undefined,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
      );

      expect(executionSucceeded).to.equal(true);

      prepaidCards.forEach(async (prepaidCard) => {
        await prepaidCardManager
          .cardDetails(prepaidCard.address)
          .should.eventually.to.include({
            issuer,
            issueToken: daicpxdToken.address,
            customizationDID:
              "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49",
          });
      });
    });

    it("should create a large number of cards without exceeding the block gas limit (truffle limits tests to 6.7M block gas limit--the true block gas limit is closer to 12.5M)", async () => {
      let numCards = 12;
      let amounts = [];
      for (let i = 0; i < numCards; i++) {
        amounts.push(toTokenUnit(10));
      }
      let { prepaidCards } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        amounts
      );
      expect(prepaidCards.length).to.equal(numCards);
    });

    it("should not create more than the maximum number of cards", async () => {
      let numCards = 16;
      let amounts = [];
      for (let i = 0; i < numCards; i++) {
        amounts.push(toTokenUnit(10));
      }
      await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        amounts
      ).should.be.rejectedWith(Error, "Too many prepaid cards requested");
    });

    it("should refund the supplier when the total amount specified to be applied to a prepaid card is less than the amount of tokens they send", async () => {
      let amount = toTokenUnit(1);
      let {
        prepaidCards,
        paymentActual,
        executionSucceeded,
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [amount], // create a 1 DAI prepaid card
        amount.add(toTokenUnit(1)) // send 2 DAI for the txn
      );

      expect(executionSucceeded).to.equal(true);
      await shouldBeSameBalance(daicpxdToken, relayer, paymentActual);

      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCards[0].address,
        toTokenUnit(1)
      );
      await shouldBeSameBalance(
        daicpxdToken,
        depot.address,
        walletAmount.sub(toTokenUnit(1)).sub(paymentActual)
      );
    });

    it("should not create card with value less than 1 token", async () => {
      await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(0)] // sending no tokens
      ).should.be.rejectedWith(Error, "Amount below threshold");
    });

    it("should not create multi Prepaid Card when the amount sent is less than the sum of the requested face values", async () => {
      await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(1), toTokenUnit(2), toTokenUnit(5)],
        toTokenUnit(5)
      ).should.be.rejectedWith(
        Error,
        "Insufficient funds sent for requested amounts"
      );
    });

    it("should not create prepaid card when the amount of cards to create is 0", async () => {
      await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [],
        toTokenUnit(7)
      ).should.be.rejectedWith(Error, "Prepaid card data invalid");
    });

    it("should not should not create a prepaid card when the token used to pay for the card is not an allowable token", async () => {
      await createPrepaidCards(
        depot,
        prepaidCardManager,
        fakeDaicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(1)]
      ).should.be.rejectedWith(Error, "calling token is unaccepted");
    });
  });

  describe("gasFeeReceiver", () => {
    let initialAmount;

    before(async () => {
      initialAmount = toTokenUnit(100);
      await prepaidCardManager.setup(
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        revenuePool.address,
        gasFeeReceiver,
        // We are setting this value specifically, which with the configured
        // exchange rate is equal to 1 DAI (100 CARD:1 DAI)
        toTokenUnit(100),
        [daicpxdToken.address, cardcpxdToken.address],
        cardcpxdToken.address,
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT
      );
    });

    beforeEach(async () => {
      // mint 100 token for depot
      await daicpxdToken.mint(depot.address, initialAmount);
    });

    after(async () => {
      // reset to 0 gasFee to make other tests easy to reason about
      await prepaidCardManager.setup(
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        revenuePool.address,
        gasFeeReceiver,
        0, // We are setting this value specifically
        [daicpxdToken.address, cardcpxdToken.address],
        cardcpxdToken.address,
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT
      );
    });

    afterEach(async () => {
      // burn all token in depot wallet
      let balance = await daicpxdToken.balanceOf(depot.address);
      let data = daicpxdToken.contract.methods.burn(balance).encodeABI();

      let safeTxData = {
        to: daicpxdToken.address,
        data,
      };

      await signAndSendSafeTransaction(safeTxData, issuer, depot, relayer);

      // burn all token in relayer wallet
      await daicpxdToken.burn(await daicpxdToken.balanceOf(relayer), {
        from: relayer,
      });

      // burn all tokens in gasReceiver wallet
      await daicpxdToken.burn(await daicpxdToken.balanceOf(gasFeeReceiver), {
        from: gasFeeReceiver,
      });
    });

    it("gasFeeReceiver should receive gas fee when prepaid card is created", async () => {
      let amount = toTokenUnit(5);

      let createCardData = encodeCreateCardsData(
        depot.address,
        [amount],
        [amount]
      );

      let transferAndCall = daicpxdToken.contract.methods.transferAndCall(
        prepaidCardManager.address,
        amount,
        createCardData
      );

      let payloads = transferAndCall.encodeABI();
      let gasEstimate = await transferAndCall.estimateGas();

      let safeTxData = {
        to: daicpxdToken.address,
        data: payloads,
        txGasEstimate: gasEstimate,
        gasPrice: 1000000000,
        txGasToken: daicpxdToken.address,
        refundReceive: relayer,
      };

      let { safeTx } = await signAndSendSafeTransaction(
        safeTxData,
        issuer,
        depot,
        relayer
      );

      let executeSuccess = getParamsFromEvent(
        safeTx,
        eventABIs.EXECUTION_SUCCESS,
        depot.address
      );

      let paymentActual = toBN(executeSuccess[0]["payment"]);
      let prepaidCard = await getGnosisSafeFromEventLog(
        safeTx,
        prepaidCardManager.address
      );

      await prepaidCardManager
        .cardDetails(prepaidCard[0].address)
        .should.eventually.to.include({
          issuer: depot.address,
          issueToken: daicpxdToken.address,
        });

      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard[0].address,
        toTokenUnit(4)
      );
      await shouldBeSameBalance(daicpxdToken, gasFeeReceiver, toTokenUnit(1));
      await shouldBeSameBalance(
        daicpxdToken,
        depot.address,
        initialAmount.sub(toTokenUnit(5)).sub(paymentActual)
      );
    });

    it("gasFeeReceiver should receive gas fee for each prepaid card created when there are more than one created", async () => {
      let amounts = [2, 4, 6].map((amount) => toTokenUnit(amount));
      let totalAmount = 12;

      let createCardData = encodeCreateCardsData(
        depot.address,
        amounts,
        amounts
      );

      let payloads = daicpxdToken.contract.methods
        .transferAndCall(
          prepaidCardManager.address,
          toTokenUnit(totalAmount),
          createCardData
        )
        .encodeABI();

      let gasEstimate = await daicpxdToken.contract.methods
        .transferAndCall(
          prepaidCardManager.address,
          toTokenUnit(totalAmount),
          createCardData
        )
        .estimateGas();

      let safeTxData = {
        to: daicpxdToken.address,
        data: payloads,
        txGasEstimate: gasEstimate,
        gasPrice: 1000000000,
        txGasToken: daicpxdToken.address,
        refundReceive: relayer,
      };

      let { safeTx } = await signAndSendSafeTransaction(
        safeTxData,
        issuer,
        depot,
        relayer
      );

      let prepaidCards = await getGnosisSafeFromEventLog(
        safeTx,
        prepaidCardManager.address
      );

      let executeSuccess = getParamsFromEvent(
        safeTx,
        eventABIs.EXECUTION_SUCCESS,
        depot.address
      );

      prepaidCards.forEach(async (prepaidCard, index) => {
        shouldBeSameBalance(
          daicpxdToken,
          prepaidCard.address,
          amounts[index].sub(toTokenUnit(1))
        );
      });

      let payment = toBN(executeSuccess[0]["payment"]);

      await shouldBeSameBalance(
        daicpxdToken,
        depot.address,
        initialAmount.sub(toTokenUnit(totalAmount)).sub(payment)
      );
      await shouldBeSameBalance(daicpxdToken, gasFeeReceiver, toTokenUnit(3)); // gas fee was sent 3 times
      await shouldBeSameBalance(daicpxdToken, relayer, payment);
    });

    it("gas fee should not be collected if gasFeeReceiver is zero address", async () => {
      await prepaidCardManager.setup(
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        revenuePool.address,
        ZERO_ADDRESS,
        // We are setting this value specifically, which with the configured
        // exchange rate is equal to 1 DAI (100 CARD:1 DAI)
        toTokenUnit(100),
        [daicpxdToken.address, cardcpxdToken.address],
        cardcpxdToken.address,
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT
      );

      let amount = toTokenUnit(5);

      let createCardData = encodeCreateCardsData(
        depot.address,
        [amount],
        [amount]
      );

      let transferAndCall = daicpxdToken.contract.methods.transferAndCall(
        prepaidCardManager.address,
        amount,
        createCardData
      );

      let payloads = transferAndCall.encodeABI();
      let gasEstimate = await transferAndCall.estimateGas();

      let safeTxData = {
        to: daicpxdToken.address,
        data: payloads,
        txGasEstimate: gasEstimate,
        gasPrice: 1000000000,
        txGasToken: daicpxdToken.address,
        refundReceive: relayer,
      };

      let { safeTx } = await signAndSendSafeTransaction(
        safeTxData,
        issuer,
        depot,
        relayer
      );

      let executeSuccess = getParamsFromEvent(
        safeTx,
        eventABIs.EXECUTION_SUCCESS,
        depot.address
      );

      let paymentActual = toBN(executeSuccess[0]["payment"]);
      let prepaidCard = await getGnosisSafeFromEventLog(
        safeTx,
        prepaidCardManager.address
      );

      await prepaidCardManager
        .cardDetails(prepaidCard[0].address)
        .should.eventually.to.include({
          issuer: depot.address,
          issueToken: daicpxdToken.address,
        });

      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard[0].address,
        toTokenUnit(5)
      );
      await shouldBeSameBalance(daicpxdToken, gasFeeReceiver, toTokenUnit(0));
      await shouldBeSameBalance(
        daicpxdToken,
        depot.address,
        initialAmount.sub(toTokenUnit(5)).sub(paymentActual)
      );

      // reset state for other tests
      await prepaidCardManager.setup(
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        revenuePool.address,
        gasFeeReceiver,
        // We are setting this value specifically, which with the configured
        // exchange rate is equal to 1 DAI (100 CARD:1 DAI)
        toTokenUnit(100),
        [daicpxdToken.address, cardcpxdToken.address],
        cardcpxdToken.address,
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT
      );
    });

    it("can get the price for a particular face value of a prepaid card", async () => {
      // the configured rate is 1 DAI : 100 SPEND
      let faceValueInSpend = 500;
      let faceValueInDai = toTokenUnit(5);
      let amount = await prepaidCardManager.priceForFaceValue(
        daicpxdToken.address,
        faceValueInSpend
      );
      amount = new toBN(amount).sub(new toBN(100)).toString(); // subtract rounding error fudge factor
      expect(amount.toString()).to.equal(
        faceValueInDai.add(toTokenUnit(1)).toString() // gas fee is 1 DAI
      );

      let createCardData = encodeCreateCardsData(
        depot.address,
        [amount],
        [amount]
      );

      let transferAndCall = daicpxdToken.contract.methods.transferAndCall(
        prepaidCardManager.address,
        amount,
        createCardData
      );

      let payloads = transferAndCall.encodeABI();
      let gasEstimate = await transferAndCall.estimateGas();

      let safeTxData = {
        to: daicpxdToken.address,
        data: payloads,
        txGasEstimate: gasEstimate,
        gasPrice: 1000000000,
        txGasToken: daicpxdToken.address,
        refundReceive: relayer,
      };

      let { safeTx } = await signAndSendSafeTransaction(
        safeTxData,
        issuer,
        depot,
        relayer
      );

      let prepaidCard = await getGnosisSafeFromEventLog(
        safeTx,
        prepaidCardManager.address
      );

      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard[0].address,
        faceValueInDai
      );
    });
  });

  describe("split prepaid card", () => {
    it("can split a card (from 1 prepaid card with 2 tokens to 2 cards with 1 token each)", async () => {
      let amounts = [1, 1].map((amount) => toTokenUnit(amount).toString());
      let splitCardData = [
        prepaidCards[1].address,
        amounts,
        amounts,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49",
      ];
      let packData = packExecutionData({
        to: daicpxdToken.address,
        data: await prepaidCardManager.getSplitCardData(...splitCardData),
      });
      let safeTxArr = Object.keys(packData).map((key) => packData[key]);
      let signature = await signSafeTransaction(
        ...safeTxArr,
        await prepaidCards[1].nonce(),
        issuer,
        prepaidCards[1]
      );

      let safeTx = await prepaidCardManager.splitCard(
        ...splitCardData,
        signature,
        {
          from: relayer,
        }
      );

      let cards = await getGnosisSafeFromEventLog(
        safeTx,
        prepaidCardManager.address
      );
      expect(cards).to.have.lengthOf(2);

      cards.forEach(async (prepaidCard, index) => {
        await prepaidCardManager
          .cardDetails(prepaidCard.address)
          .should.eventually.to.include({
            issuer,
            issueToken: daicpxdToken.address,
            customizationDID:
              "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49",
          });

        await prepaidCard.isOwner(issuer).should.become(true);
        await prepaidCard
          .isOwner(prepaidCardManager.address)
          .should.become(true);

        shouldBeSameBalance(daicpxdToken, prepaidCard.address, amounts[index]);
      });
    });

    it("a prepaid card cannot be split after it is transferred", async () => {
      await daicpxdToken.mint(depot.address, toTokenUnit(3));
      let {
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(2)]
      );

      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        customer,
        relayer
      );

      let amounts = [1, 1].map((amount) => toTokenUnit(amount).toString());
      let splitCardData = [prepaidCard.address, amounts, amounts, ""];
      let packData = packExecutionData({
        to: daicpxdToken.address,
        data: await prepaidCardManager.getSplitCardData(...splitCardData),
      });
      let safeTxArr = Object.keys(packData).map((key) => packData[key]);
      let signature = await signSafeTransaction(
        ...safeTxArr,
        await prepaidCard.nonce(),
        customer,
        prepaidCard
      );

      await prepaidCardManager
        .splitCard(...splitCardData, signature, {
          from: relayer,
        })
        .should.be.rejectedWith(Error, "only issuer can split card");
    });

    it("can reject when provided signature is invalid", async () => {
      let amounts = [2, 2].map((amount) => toTokenUnit(amount).toString());
      let splitCardData = [prepaidCards[2].address, amounts, amounts, ""];
      await prepaidCardManager
        .splitCard(...splitCardData, "0x01", {
          from: relayer,
        })
        .should.be.rejectedWith(Error, "Invalid signature!");
    });
  });

  describe("transfer a prepaid card", () => {
    let prepaidCard;
    before(() => {
      prepaidCard = prepaidCards[2];
    });

    it("can transfer a card to a customer", async () => {
      let startingDaiBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );

      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        customer,
        relayer
      );

      await prepaidCard.isOwner(customer).should.eventually.become(true);
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        startingDaiBalance
      );
    });

    // These tests are stateful (ugh), so the transfer that happened in the
    // previous test counts against the transfer that is attempted in this test
    it("can not re-transfer a prepaid card that has already been transferred once", async () => {
      let otherCustomer = accounts[9];
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        customer,
        otherCustomer,
        relayer
      ).should.be.rejectedWith(Error, "Has already been transferred");
    });
  });

  describe("use prepaid card for payment", () => {
    let prepaidCard;

    before(async () => {
      prepaidCard = prepaidCards[2];
      await daicpxdToken.mint(depot.address, toTokenUnit(100));
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
        merchant,
        relayer
      );
      // mint gas token token for prepaid card
      await cardcpxdToken.mint(merchantPrepaidCard.address, toTokenUnit(100));
      let merchantTx = await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        merchant,
        1000
      );
      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        revenuePool.address
      );
      merchantSafe = merchantCreation[0]["merchantSafe"];
      await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(1000000));
    });

    after(async () => {
      // burn all token in depot wallet
      let balance = await daicpxdToken.balanceOf(depot.address);
      let data = daicpxdToken.contract.methods.burn(balance).encodeABI();

      let safeTxData = {
        to: daicpxdToken.address,
        data,
      };

      await signAndSendSafeTransaction(safeTxData, issuer, depot, relayer);

      // burn all token in relayer wallet
      await daicpxdToken.burn(await daicpxdToken.balanceOf(relayer), {
        from: relayer,
      });

      // burn all tokens in gasReceiver wallet
      await daicpxdToken.burn(await daicpxdToken.balanceOf(gasFeeReceiver), {
        from: gasFeeReceiver,
      });
    });

    it("can be used to pay a merchant", async () => {
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let startingRevenuePoolDaicpxdBalance = await getBalance(
        daicpxdToken,
        revenuePool.address
      );
      let startingPrepaidCardCardcpxdBalance = await getBalance(
        cardcpxdToken,
        prepaidCard.address
      );
      let startingRelayerCardcpxdBalance = await getBalance(
        cardcpxdToken,
        relayer
      );
      let startingRevenuePoolCardcpxdBalance = await getBalance(
        cardcpxdToken,
        revenuePool.address
      );

      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        merchantSafe,
        100
      );

      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        startingRevenuePoolDaicpxdBalance.add(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        cardcpxdToken,
        prepaidCard.address,
        startingPrepaidCardCardcpxdBalance
      );
      await shouldBeSameBalance(
        cardcpxdToken,
        relayer,
        startingRelayerCardcpxdBalance
      );
      await shouldBeSameBalance(
        cardcpxdToken,
        revenuePool.address,
        startingRevenuePoolCardcpxdBalance
      );
    });

    // These tests are stateful (ugh), so the prepaidCards[2] balance is now 4
    // daicpxd due to the payment of 1 token made in the previous test
    it("can not send more funds to a merchant than the balance of the prepaid card", async () => {
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        merchantSafe,
        1000
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );
      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        toTokenUnit(1)
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        toTokenUnit(4)
      );
    });

    it("can not send less funds to a merchant than the minimum merchant payment amount", async () => {
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customer,
        merchantSafe,
        40
      ).should.be.rejectedWith(Error, "payment too small");
      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        toTokenUnit(1)
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        toTokenUnit(4)
      );
    });
  });

  describe("roles", () => {
    it("can add and remove a payable token", async () => {
      let mockPayableTokenAddr = accounts[9];

      await prepaidCardManager.addPayableToken(mockPayableTokenAddr).should.be
        .fulfilled;

      await prepaidCardManager.removePayableToken(daicpxdToken.address).should
        .be.fulfilled;
      await prepaidCardManager.removePayableToken(cardcpxdToken.address).should
        .be.fulfilled;

      await prepaidCardManager
        .getTokens()
        .should.become([mockPayableTokenAddr]);
    });
  });
  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await prepaidCardManager.cardpayVersion()).to.match(/\d\.\d\.\d/);
    });
  });
});
