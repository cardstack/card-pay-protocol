const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const ERC677Token = artifacts.require("ERC677Token.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const MerchantManager = artifacts.require("MerchantManager");

const eventABIs = require("./utils/constant/eventABIs");
const {
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
  payMerchant,
  transferOwner,
  createDepotFromSupplierMgr,
  addActionHandlers,
  splitPrepaidCard,
} = require("./utils/helper");

const { expect, TOKEN_DETAIL_DATA, toBN } = require("./setup");
const AbiCoder = require("web3-eth-abi");

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
    tokenManager,
    supplierManager,
    actionDispatcher,
    payMerchantHandler,
    splitPrepaidCardHandler,
    transferPrepaidCardHandler,
    merchantManager,
    owner,
    issuer,
    customer,
    customerA,
    customerB,
    gasFeeReceiver,
    merchantFeeReceiver,
    merchantSafe,
    relayer,
    depot,
    prepaidCards = [];

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
    supplierManager = await SupplierManager.new();
    await supplierManager.initialize(owner);
    actionDispatcher = await ActionDispatcher.new();
    await actionDispatcher.initialize(owner);
    tokenManager = await TokenManager.new();
    await tokenManager.initialize(owner);
    merchantManager = await MerchantManager.new();
    await merchantManager.initialize(owner);

    customerA = findAccountBeforeAddress(
      accounts.slice(10),
      prepaidCardManager.address
    );
    customerB = findAccountAfterAddress(
      accounts.slice(10),
      prepaidCardManager.address
    );

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
      merchantManager.address,
      actionDispatcher.address,
      prepaidCardManager.address,
      merchantFeeReceiver,
      0,
      1000
    );
    ({
      payMerchantHandler,
      splitPrepaidCardHandler,
      transferPrepaidCardHandler,
    } = await addActionHandlers(
      prepaidCardManager,
      revenuePool,
      actionDispatcher,
      merchantManager,
      owner,
      exchange.address,
      spendToken.address
    ));
    await spendToken.addMinter(payMerchantHandler.address);
    await tokenManager.setup(ZERO_ADDRESS, [
      daicpxdToken.address,
      cardcpxdToken.address,
    ]);
    await merchantManager.setup(
      actionDispatcher.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address
    );
    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address
    );
    await supplierManager.setup(
      ZERO_ADDRESS,
      gnosisSafeMasterCopy.address,
      proxyFactory.address
    );
    depot = await createDepotFromSupplierMgr(supplierManager, issuer);

    MINIMUM_AMOUNT = 100; // in spend <=> 1 USD
    MAXIMUM_AMOUNT = 500000; // in spend <=>  5000 USD
  });

  describe("setup contract", () => {
    before(async () => {
      // Setup card manager contract
      await prepaidCardManager.setup(
        tokenManager.address,
        supplierManager.address,
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        actionDispatcher.address,
        gasFeeReceiver,
        0,
        cardcpxdToken.address,
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT
      );
      await prepaidCardManager.addGasPolicy("transfer", false, true);
      await prepaidCardManager.addGasPolicy("split", true, true);
    });

    it("should initialize parameters", async () => {
      expect(await prepaidCardManager.tokenManager()).to.equal(
        tokenManager.address
      );
      expect(await prepaidCardManager.supplierManager()).to.equal(
        supplierManager.address
      );
      expect(await prepaidCardManager.gnosisSafe()).to.equal(
        gnosisSafeMasterCopy.address
      );
      expect(await prepaidCardManager.gnosisProxyFactory()).to.equal(
        proxyFactory.address
      );
      expect(await prepaidCardManager.actionDispatcher()).to.deep.equal(
        actionDispatcher.address
      );
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
        tokenManager.address,
        supplierManager.address,
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        actionDispatcher.address,
        gasFeeReceiver,
        // We are setting this value specifically, which with the configured
        // exchange rate is equal to 1 DAI (100 CARD:1 DAI)
        toTokenUnit(100),
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
        tokenManager.address,
        supplierManager.address,
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        actionDispatcher.address,
        gasFeeReceiver,
        0, // We are setting this value specifically
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
        tokenManager.address,
        supplierManager.address,
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        actionDispatcher.address,
        ZERO_ADDRESS,
        // We are setting this value specifically, which with the configured
        // exchange rate is equal to 1 DAI (100 CARD:1 DAI)
        toTokenUnit(100),
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
        tokenManager.address,
        supplierManager.address,
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        actionDispatcher.address,
        gasFeeReceiver,
        // We are setting this value specifically, which with the configured
        // exchange rate is equal to 1 DAI (100 CARD:1 DAI)
        toTokenUnit(100),
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
      let safeTx = await splitPrepaidCard(
        prepaidCardManager,
        prepaidCards[1],
        daicpxdToken,
        relayer,
        issuer,
        200,
        amounts,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
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
        cardcpxdToken,
        relayer,
        daicpxdToken
      );

      let amounts = [1, 1].map((amount) => toTokenUnit(amount).toString());
      await splitPrepaidCard(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        relayer,
        customer,
        200,
        amounts,
        ""
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );
    });

    it("a prepaid card used to fund a split cannot be transferred", async () => {
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
      let amounts = [1, 1].map((amount) => toTokenUnit(amount).toString());
      await splitPrepaidCard(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        relayer,
        issuer,
        200,
        amounts,
        ""
      );
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        customer,
        cardcpxdToken,
        relayer,
        daicpxdToken
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );
    });

    it("does not allow non-action dispatcher to call transferAndCall SplitPrepaidCardHandler", async () => {
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
      let amounts = [1, 1].map((amount) => toTokenUnit(amount).toString());
      await daicpxdToken
        .transferAndCall(
          splitPrepaidCardHandler.address,
          toTokenUnit(2),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              200,
              AbiCoder.encodeParameters(
                ["uint256[]", "uint256[]", "string"],
                [amounts, amounts, ""]
              ),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it("does not allow non-action handler to call setPrepaidCardUsedForSplit", async () => {
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
      await prepaidCardManager
        .setPrepaidCardUsedForSplit(prepaidCard.address)
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
    });
  });

  describe("transfer a prepaid card", () => {
    let prepaidCard;
    before(async () => {
      prepaidCard = prepaidCards[2];
      // mint gas token token for prepaid card
      await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(100));
    });

    // Warning this test is stateful, all the other tests rely on this prepaid
    // card being transferred to a customer
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
        cardcpxdToken,
        relayer,
        daicpxdToken
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
        cardcpxdToken,
        relayer,
        daicpxdToken
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );
    });

    it("does not allow non-action dispatcher to call transferAndCall on TransferPrepaidCardHandler", async () => {
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
      await daicpxdToken
        .transferAndCall(
          transferPrepaidCardHandler.address,
          0,
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0,
              AbiCoder.encodeParameters(
                ["address", "bytes"],
                [customer, "0x0"]
              ),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it("does not allow non-action handler to call transfer on PrepaidCardManager", async () => {
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
      await prepaidCardManager
        .transfer(prepaidCard.address, customer, "0x0")
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
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
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      // mint gas token token for prepaid card
      await cardcpxdToken.mint(merchantPrepaidCard.address, toTokenUnit(100));
      let merchantTx = await merchantManager.registerMerchant(merchant, "");
      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        merchantManager.address
      );
      merchantSafe = merchantCreation[0]["merchantSafe"];
      await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(100));
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

    it("can sign with address lexigraphically before prepaid card manager contract address", async () => {
      let {
        prepaidCards: [prepaidCardA],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(1)]
      );
      await transferOwner(
        prepaidCardManager,
        prepaidCardA,
        issuer,
        customerA,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      // mint gas token token for prepaid card
      await cardcpxdToken.mint(prepaidCardA.address, toTokenUnit(100));

      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        prepaidCardA.address
      );
      let startingRevenuePoolDaicpxdBalance = await getBalance(
        daicpxdToken,
        revenuePool.address
      );
      await payMerchant(
        prepaidCardManager,
        prepaidCardA,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customerA,
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
        prepaidCardA.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(1))
      );
    });

    it("can sign with address lexigraphically after prepaid card manager contract address", async () => {
      let {
        prepaidCards: [prepaidCardB],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(1)]
      );
      await transferOwner(
        prepaidCardManager,
        prepaidCardB,
        issuer,
        customerB,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      // mint gas token token for prepaid card
      await cardcpxdToken.mint(prepaidCardB.address, toTokenUnit(100));

      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        prepaidCardB.address
      );
      let startingRevenuePoolDaicpxdBalance = await getBalance(
        daicpxdToken,
        revenuePool.address
      );
      await payMerchant(
        prepaidCardManager,
        prepaidCardB,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        customerB,
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
        prepaidCardB.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(1))
      );
    });

    // These tests are stateful (ugh), so the prepaidCards[2] balance is now 4
    // daicpxd due to the payment of 1 token made in the previous test
    it("can not send more funds to a merchant than the balance of the prepaid card", async () => {
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let startingRevenuePoolDaicpxdBalance = await getBalance(
        daicpxdToken,
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
        startingRevenuePoolDaicpxdBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        startingPrepaidCardDaicpxdBalance
      );
    });

    it("can not send less funds to a merchant than the minimum merchant payment amount", async () => {
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let startingRevenuePoolDaicpxdBalance = await getBalance(
        daicpxdToken,
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
        40
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        "safe transaction was reverted"
      );
      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        startingRevenuePoolDaicpxdBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        startingPrepaidCardDaicpxdBalance
      );
    });
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await prepaidCardManager.cardpayVersion()).to.match(/\d\.\d\.\d/);
      expect(await payMerchantHandler.cardpayVersion()).to.match(/\d\.\d\.\d/);
      expect(await splitPrepaidCardHandler.cardpayVersion()).to.match(
        /\d\.\d\.\d/
      );
      expect(await transferPrepaidCardHandler.cardpayVersion()).to.match(
        /\d\.\d\.\d/
      );
    });
  });
});

function findAccountBeforeAddress(accounts, address) {
  for (let account of accounts) {
    if (account.toLowerCase() < address.toLowerCase()) {
      return account;
    }
  }
  throw new Error(
    `Could not find an account address that is lexigraphically before the address ${address} from ${accounts.length} possibilities. Make sure you are using ganache (yarn ganache:start) to run your private chain and try increasing the number of accounts to test with.`
  );
}

function findAccountAfterAddress(accounts, address) {
  for (let account of accounts) {
    if (account.toLowerCase() > address.toLowerCase()) {
      return account;
    }
  }
  throw new Error(
    `Could not find an account address that is lexigraphically after the address ${address} from ${accounts.length} possibilities. Make sure you are using ganache (yarn ganache:start) to run your private chain and try increasing the number of accounts to test with.`
  );
}
