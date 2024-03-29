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
const BridgeUtils = artifacts.require("BridgeUtils");
const PrepaidCardMarket = artifacts.require("PrepaidCardMarket");

const eventABIs = require("./utils/constant/eventABIs");
const {
  ZERO_ADDRESS,
  getParamsFromEvent,
  getGnosisSafeFromEventLog,
  gnosisErrors: { SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET },
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
  findAccountBeforeAddress,
  findAccountAfterAddress,
  setupVersionManager,
  createPrepaidCardAndTransfer,
  registerMerchant,
  burnDepotTokens,
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
    prepaidCardMarket,
    owner,
    issuer,
    customer,
    customerA,
    customerB,
    gasFeeReceiver,
    merchantFeeReceiver,
    versionManager,
    merchantSafe,
    contractSigner,
    trustedCallerForCreatingPrepaidCardsWithIssuer,
    relayer,
    depot,
    prepaidCards = [],
    walletAmount;

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    customer = accounts[2];
    merchant = accounts[3];
    relayer = accounts[4];
    gasFeeReceiver = accounts[5];
    merchantFeeReceiver = accounts[6];
    contractSigner = accounts[7];
    trustedCallerForCreatingPrepaidCardsWithIssuer = accounts[8];
    walletAmount = toTokenUnit(1000);

    versionManager = await setupVersionManager(owner);
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
    let bridgeUtils = await BridgeUtils.new();
    await bridgeUtils.initialize(owner);

    customerA = findAccountBeforeAddress(
      accounts.slice(10),
      prepaidCardManager.address
    );
    customerB = findAccountAfterAddress(
      accounts.slice(10),
      prepaidCardManager.address
    );
    let cardcpxdToken;
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
      1000,
      versionManager.address
    );
    ({
      payMerchantHandler,
      splitPrepaidCardHandler,
      transferPrepaidCardHandler,
    } = await addActionHandlers({
      prepaidCardManager,
      revenuePool,
      actionDispatcher,
      merchantManager,
      tokenManager,
      owner,
      exchangeAddress: exchange.address,
      spendAddress: spendToken.address,
      versionManager,
    }));
    await spendToken.addMinter(payMerchantHandler.address);
    await tokenManager.setup(
      ZERO_ADDRESS,
      [daicpxdToken.address, cardcpxdToken.address],
      versionManager.address
    );
    await merchantManager.setup(
      actionDispatcher.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      [relayer],
      versionManager.address
    );
    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address,
      versionManager.address
    );
    await supplierManager.setup(
      bridgeUtils.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      versionManager.address
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
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT,
        [contractSigner],
        [trustedCallerForCreatingPrepaidCardsWithIssuer],
        versionManager.address
      );
      await prepaidCardManager.addGasPolicy("transfer", false);
      await prepaidCardManager.addGasPolicy("split", false);
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
      expect(await prepaidCardManager.actionDispatcher()).to.equal(
        actionDispatcher.address
      );
      expect(await prepaidCardManager.minimumFaceValue()).to.a.bignumber.equal(
        toBN(MINIMUM_AMOUNT)
      );
      expect(await prepaidCardManager.maximumFaceValue()).to.a.bignumber.equal(
        toBN(MAXIMUM_AMOUNT)
      );
      expect(await prepaidCardManager.getContractSigners()).to.deep.equal([
        contractSigner,
      ]);
      expect(await prepaidCardManager.getContractSigners()).to.deep.equal([
        contractSigner,
      ]);
      expect(
        await prepaidCardManager.getTrustedCallersForCreatingPrepaidCardsWithIssuer()
      ).to.deep.equal([trustedCallerForCreatingPrepaidCardsWithIssuer]);
    });

    it("can get version of contract", async () => {
      expect(await prepaidCardManager.cardpayVersion()).to.equal("1.0.0");
      expect(await payMerchantHandler.cardpayVersion()).to.equal("1.0.0");
      expect(await splitPrepaidCardHandler.cardpayVersion()).to.equal("1.0.0");
      expect(await transferPrepaidCardHandler.cardpayVersion()).to.equal(
        "1.0.0"
      );
    });

    it("rejects when non-owner removes a contract signer", async () => {
      await prepaidCardManager
        .removeContractSigner(contractSigner, { from: customer })
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });

    it("can remove a contract signer", async () => {
      await prepaidCardManager.removeContractSigner(contractSigner);
      expect(await prepaidCardManager.getContractSigners()).to.deep.equal([]);
    });

    it("rejects when non-owner removes a contract signer", async () => {
      await prepaidCardManager
        .removeTrustedCallerForCreatingPrepaidCardsWithIssuer(
          trustedCallerForCreatingPrepaidCardsWithIssuer,
          {
            from: customer,
          }
        )
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });

    it("can remove a contract signer", async () => {
      await prepaidCardManager.removeTrustedCallerForCreatingPrepaidCardsWithIssuer(
        trustedCallerForCreatingPrepaidCardsWithIssuer
      );
      expect(await prepaidCardManager.getContractSigners()).to.deep.equal([]);
    });
  });

  describe("create prepaid card", () => {
    before(async () => {
      await prepaidCardManager.setup(
        tokenManager.address,
        supplierManager.address,
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        actionDispatcher.address,
        gasFeeReceiver,
        0,
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT,
        [contractSigner],
        [],
        versionManager.address
      );
      await prepaidCardManager.addGasPolicy("transfer", false);
      await prepaidCardManager.addGasPolicy("split", false);
    });

    beforeEach(async () => {
      // mint 100 token for depot
      await daicpxdToken.mint(depot.address, walletAmount);
    });

    afterEach(async () => {
      await burnDepotTokens(depot, daicpxdToken, issuer, relayer);
      // burn all token in relayer wallet
      await daicpxdToken.burn(await daicpxdToken.balanceOf(relayer), {
        from: relayer,
      });
    });

    it("should create prepaid card when balance is 1 token", async () => {
      let amount = toTokenUnit(1);
      let { prepaidCards, paymentActual, executionSucceeded } =
        await createPrepaidCards(
          depot,
          prepaidCardManager,
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
      expect(
        (await prepaidCardManager.faceValue(prepaidCards[0].address)).toString()
      ).to.equal("100");
    });

    it("should create prepaid card with customization DID", async () => {
      let amount = toTokenUnit(1);
      let { prepaidCards, executionSucceeded } = await createPrepaidCards(
        depot,
        prepaidCardManager,
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

    it("should create a large number of cards without exceeding the block gas limit (truffle limits tests to 6.7M block gas limit--the true block gas limit is closer to 12.5M)", async function () {
      this.timeout(60000);
      let numCards = 12;
      let amounts = [];
      for (let i = 0; i < numCards; i++) {
        amounts.push(toTokenUnit(10));
      }
      let { prepaidCards } = await createPrepaidCards(
        depot,
        prepaidCardManager,
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
        issuer,
        relayer,
        amounts
      ).should.be.rejectedWith(Error, "Too many prepaid cards requested");
    });

    it("should refund the supplier when the total amount specified to be applied to a prepaid card is less than the amount of tokens they send", async () => {
      let amount = toTokenUnit(1);
      let { prepaidCards, paymentActual, executionSucceeded } =
        await createPrepaidCards(
          depot,
          prepaidCardManager,
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
        issuer,
        relayer,
        [],
        toTokenUnit(7)
      ).should.be.rejectedWith(Error, "Prepaid card data invalid");
    });

    it("should not should not create a prepaid card when the token used to pay for the card is not an allowable token", async () => {
      await fakeDaicpxdToken.mint(depot.address, toTokenUnit(1));
      await createPrepaidCards(
        depot,
        prepaidCardManager,
        fakeDaicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(1)]
      ).should.be.rejectedWith(Error, "calling token is unaccepted");
    });

    it("should not create multi Prepaid Card when the amount sent is more than the sum of the requested face values from an EOA", async () => {
      await daicpxdToken.mint(issuer, toTokenUnit(50));

      let createCardData = encodeCreateCardsData(
        issuer,
        [toTokenUnit(1).toString()],
        [toTokenUnit(1).toString()]
      );

      let amountToSend = toTokenUnit(50);

      await daicpxdToken.transferAndCall(
        prepaidCardManager.address,
        amountToSend,
        createCardData,
        { from: issuer }
      );

      let newBalance = await daicpxdToken.balanceOf(issuer);

      expect(newBalance).to.be.bignumber.eq(
        toTokenUnit(49),
        "excess funds should be returned to sender"
      );
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
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT,
        [],
        [],
        versionManager.address
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
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT,
        [],
        [],
        versionManager.address
      );
    });

    afterEach(async () => {
      await burnDepotTokens(depot, daicpxdToken, issuer, relayer);
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
        refundReceiver: relayer,
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
        refundReceiver: relayer,
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
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT,
        [],
        [],
        versionManager.address
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
        refundReceiver: relayer,
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
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT,
        [],
        [],
        versionManager.address
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
        refundReceiver: relayer,
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
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT,
        [contractSigner],
        [],
        versionManager.address
      );
      await prepaidCardManager.addGasPolicy("transfer", false);
      await prepaidCardManager.addGasPolicy("split", false);
    });

    beforeEach(async () => {
      await daicpxdToken.mint(depot.address, walletAmount);
      let amounts = [1, 2, 5].map((amount) => toTokenUnit(amount));
      ({ prepaidCards } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        amounts
      ));
    });

    afterEach(async () => {
      await burnDepotTokens(depot, daicpxdToken, issuer, relayer);
      // burn all token in relayer wallet
      await daicpxdToken.burn(await daicpxdToken.balanceOf(relayer), {
        from: relayer,
      });
    });

    it("can split a card (from 1 prepaid card with 2 tokens to 2 cards with 1 token each)", async () => {
      let amounts = [1, 1].map((amount) => toTokenUnit(amount).toString());

      prepaidCardMarket = await PrepaidCardMarket.new();
      await prepaidCardMarket.initialize(owner);
      await prepaidCardMarket.setup(
        prepaidCardManager.address,
        actionDispatcher.address,
        owner,
        versionManager.address
      );

      let safeTx = await splitPrepaidCard(
        prepaidCardManager,
        prepaidCards[1],
        relayer,
        issuer,
        200,
        amounts,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49",
        prepaidCardMarket.address,
        0
      );

      let usedEvents = safeTx.logs.filter((e) => e.event == "PrepaidCardUsed");
      expect(usedEvents[0].args.card).to.eq(prepaidCards[1].address);

      let cards = await getGnosisSafeFromEventLog(
        safeTx,
        prepaidCardManager.address
      );
      expect(cards).to.have.lengthOf(2);

      let index = 0;
      for (let prepaidCard of cards) {
        await prepaidCardManager
          .cardDetails(prepaidCard.address)
          .should.eventually.to.include({
            issuer,
            issueToken: daicpxdToken.address,
            customizationDID:
              "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49",
          });

        expect(await prepaidCard.getOwners()).to.have.members([
          prepaidCardMarket.address,
          prepaidCardManager.address,
        ]);
        await prepaidCard
          .isOwner(prepaidCardManager.address)
          .should.become(true);

        shouldBeSameBalance(daicpxdToken, prepaidCard.address, amounts[index]);
        index++;
      }
    });

    it("a prepaid card cannot be split after it is transferred", async () => {
      await daicpxdToken.mint(depot.address, toTokenUnit(3));
      let prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(2),
        customer
      );
      let amounts = [1, 1].map((amount) => toTokenUnit(amount).toString());
      await splitPrepaidCard(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        200,
        amounts,
        "",
        null,
        0
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
        issuer,
        relayer,
        [toTokenUnit(2)]
      );
      let amounts = [1, 1].map((amount) => toTokenUnit(amount).toString());
      await splitPrepaidCard(
        prepaidCardManager,
        prepaidCard,
        relayer,
        issuer,
        200,
        amounts,
        "",
        null,
        0
      );
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        customer,
        relayer
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET
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

    it("does not allow non-CPXD token to call SplitPrepaidCardHandler", async () => {
      await daicpxdToken.mint(depot.address, toTokenUnit(3));
      let {
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(2)]
      );
      let amounts = [1, 1].map((amount) => toTokenUnit(amount).toString());
      await fakeDaicpxdToken
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
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });

    it("does not allow non-action handler to call setPrepaidCardUsed", async () => {
      await daicpxdToken.mint(depot.address, toTokenUnit(3));
      let {
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(2)]
      );
      await prepaidCardManager
        .setPrepaidCardUsed(prepaidCard.address)
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
    });
  });

  describe("transfer a prepaid card", () => {
    let prepaidCard;
    before(async () => {
      await prepaidCardManager.setup(
        tokenManager.address,
        supplierManager.address,
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        actionDispatcher.address,
        gasFeeReceiver,
        0,
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT,
        [contractSigner],
        [],
        versionManager.address
      );
      await prepaidCardManager.addGasPolicy("transfer", false);
      await prepaidCardManager.addGasPolicy("split", false);
    });

    beforeEach(async () => {
      await daicpxdToken.mint(depot.address, walletAmount);
      ({ prepaidCards } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(2)]
      ));
      prepaidCard = prepaidCards[0];
    });

    afterEach(async () => {
      await burnDepotTokens(depot, daicpxdToken, issuer, relayer);
      // burn all token in relayer wallet
      await daicpxdToken.burn(await daicpxdToken.balanceOf(relayer), {
        from: relayer,
      });
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

    it("can not re-transfer a prepaid card that has already been transferred once", async () => {
      let otherCustomer = accounts[9];
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
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        customer,
        otherCustomer,
        relayer
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET
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

    it("does not allow non-CPXD token to call TransferPrepaidCardHandler", async () => {
      await daicpxdToken.mint(depot.address, toTokenUnit(3));
      let {
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(2)]
      );
      await fakeDaicpxdToken
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
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });

    it("does not allow non-action handler to call transfer on PrepaidCardManager", async () => {
      await daicpxdToken.mint(depot.address, toTokenUnit(3));
      let {
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
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
      await prepaidCardManager.setup(
        tokenManager.address,
        supplierManager.address,
        exchange.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        actionDispatcher.address,
        gasFeeReceiver,
        0,
        MINIMUM_AMOUNT,
        MAXIMUM_AMOUNT,
        [contractSigner],
        [],
        versionManager.address
      );
      await prepaidCardManager.addGasPolicy("transfer", false);
      await prepaidCardManager.addGasPolicy("split", false);

      await daicpxdToken.mint(depot.address, toTokenUnit(100));

      prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5),
        customer
      );

      let merchantPrepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(10),
        merchant
      );
      const merchantTx = await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        relayer,
        merchant,
        1000,
        undefined,
        "did:cardstack:another-merchant-safe"
      );

      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        merchantManager.address
      );
      merchantSafe = merchantCreation[0]["merchantSafe"];

      expect(await merchantManager.getMerchantAddresses()).to.include(merchant);
    });

    after(async () => {
      await burnDepotTokens(depot, daicpxdToken, issuer, relayer);
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
      expect(
        (await prepaidCardManager.faceValue(prepaidCard.address)).toString()
      ).to.equal("500");

      await payMerchant(
        prepaidCardManager,
        prepaidCard,
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
      expect(
        (await prepaidCardManager.faceValue(prepaidCard.address)).toString()
      ).to.equal("400");
    });

    it("can sign with address lexigraphically before prepaid card manager contract address", async () => {
      let prepaidCardA = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(1),
        customerA
      );

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
      let prepaidCardB = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5),
        customerB
      );

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

    it("can not transfer a prepaid card that has been used to pay a merchant", async () => {
      let {
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(1)]
      );
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        issuer,
        merchantSafe,
        100
      );
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        customer,
        relayer
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET
      );
    });

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
        relayer,
        customer,
        merchantSafe,
        1000
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET
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
        relayer,
        customer,
        merchantSafe,
        40
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET
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
});
