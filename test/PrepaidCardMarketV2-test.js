const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const PrepaidCardMarketV2 = artifacts.require("PrepaidCardMarketV2");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");
const BridgeUtils = artifacts.require("BridgeUtils");
const { ZERO_ADDRESS, getParamsFromEvent } = utils;
const { expect } = require("./setup");

const {
  toTokenUnit,
  setupExchanges,
  createDepotFromSupplierMgr,
  setupVersionManager,
  signAndSendSafeTransaction,
  createPrepaidCards,
  addPrepaidCardSKU,
  addActionHandlers,
  setPrepaidCardAsk,
  transferOwner,
} = require("./utils/helper");

const AbiCoder = require("web3-eth-abi");
const { toWei } = require("web3-utils");

contract("PrepaidCardMarketV2", (accounts) => {
  let daicpxdToken,
    cardcpxdToken,
    issuer,
    owner,
    relayer,
    actionDispatcher,
    proxyFactory,
    gnosisSafeMasterCopy,
    provisioner,
    customer,
    exchange,
    prepaidCardManager,
    prepaidCardMarket,
    prepaidCardMarketV2,
    versionManager,
    depot,
    depositTokens,
    withdrawTokens,
    addPrepaidCardSKUHandler;

  async function makePrepaidCards(amounts, marketAddress, issuerSafe) {
    let { prepaidCards } = await createPrepaidCards(
      depot,
      prepaidCardManager,
      daicpxdToken,
      issuer,
      relayer,
      amounts,
      null,
      "did:cardstack:test",
      marketAddress,
      issuerSafe
    );
    return prepaidCards;
  }

  beforeEach(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    relayer = accounts[4];
    provisioner = accounts[5];
    prepaidCardMarket = accounts[6];
    customer = accounts[7];

    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await utils.deployContract(
      "deploying Gnosis Safe Mastercopy",
      GnosisSafe
    );

    versionManager = await setupVersionManager(owner);
    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);
    prepaidCardMarketV2 = await PrepaidCardMarketV2.new();
    await prepaidCardMarketV2.initialize(owner);
    let supplierManager = await SupplierManager.new();
    await supplierManager.initialize(owner);
    actionDispatcher = await ActionDispatcher.new();
    await actionDispatcher.initialize(owner);
    let bridgeUtils = await BridgeUtils.new();
    await bridgeUtils.initialize(owner);

    let tokenManager = await TokenManager.new();
    await tokenManager.initialize(owner);

    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));

    await daicpxdToken.mint(owner, toTokenUnit(100));

    await tokenManager.setup(
      ZERO_ADDRESS,
      [daicpxdToken.address, cardcpxdToken.address],
      versionManager.address
    );

    await supplierManager.setup(
      bridgeUtils.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      versionManager.address
    );
    await prepaidCardManager.setup(
      tokenManager.address,
      supplierManager.address,
      exchange.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      actionDispatcher.address,
      ZERO_ADDRESS,
      0,
      100,
      500000,
      [prepaidCardMarket],
      [prepaidCardMarketV2.address],
      versionManager.address
    );
    await prepaidCardManager.addGasPolicy("addPrepaidCardSKU", true);
    await prepaidCardManager.addGasPolicy("setPrepaidCardAsk", true);

    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address,
      versionManager.address
    );

    await prepaidCardMarketV2.setup(
      prepaidCardManager.address,
      provisioner,
      tokenManager.address,
      actionDispatcher.address,
      [relayer], // trusted provisioners
      versionManager.address
    );

    ({ addPrepaidCardSKUHandler } = await addActionHandlers({
      prepaidCardManager,
      prepaidCardMarketV2,
      actionDispatcher,
      tokenManager,
      owner,
      versionManager,
    }));

    depot = await createDepotFromSupplierMgr(supplierManager, issuer);
    await daicpxdToken.mint(depot.address, toTokenUnit(1000));

    await cardcpxdToken.mint(depot.address, toTokenUnit(1000));

    depositTokens = async (amount) => {
      let transferAndCall = daicpxdToken.contract.methods.transferAndCall(
        prepaidCardMarketV2.address,
        amount,
        AbiCoder.encodeParameters(["address"], [issuer])
      );

      let payload = transferAndCall.encodeABI();
      let gasEstimate = await transferAndCall.estimateGas({
        from: depot.address,
      });

      let safeTxData = {
        to: daicpxdToken.address,
        data: payload,
        txGasEstimate: gasEstimate,
        gasPrice: 1000000000,
        txGasToken: daicpxdToken.address,
        refundReceiver: relayer,
      };

      return await signAndSendSafeTransaction(
        safeTxData,
        issuer,
        depot,
        relayer
      );
    };

    withdrawTokens = async (amount) => {
      let withdrawTokens = prepaidCardMarketV2.contract.methods.withdrawTokens(
        amount,
        daicpxdToken.address
      );

      let payload = withdrawTokens.encodeABI();
      let gasEstimate = await withdrawTokens.estimateGas({
        from: depot.address,
      });
      let safeTxData = {
        to: prepaidCardMarketV2.address,
        data: payload,
        txGasEstimate: gasEstimate,
        gasPrice: 1000000000,
        txGasToken: daicpxdToken.address,
        refundReceiver: relayer,
      };

      return await signAndSendSafeTransaction(
        safeTxData,
        issuer,
        depot,
        relayer
      );
    };
  });

  describe("setup", () => {
    it("should set trusted provisioners", async () => {
      await prepaidCardMarketV2.setup(
        prepaidCardManager.address,
        provisioner,
        (
          await TokenManager.new()
        ).address,
        actionDispatcher.address,
        [relayer],
        versionManager.address
      );
      expect(
        await prepaidCardMarketV2.getTrustedProvisioners()
      ).to.have.members([relayer]);
    });
  });

  describe("removing trusted provisioners", () => {
    it("can remove trusted provisioners", async () => {
      await prepaidCardMarketV2.setup(
        prepaidCardManager.address,
        provisioner,
        (
          await TokenManager.new()
        ).address,
        actionDispatcher.address,
        [relayer],
        versionManager.address
      );
      expect(
        await prepaidCardMarketV2.getTrustedProvisioners()
      ).to.have.members([relayer]);

      await prepaidCardMarketV2.removeTrustedProvisioner(relayer);

      expect(await prepaidCardMarketV2.getTrustedProvisioners()).to.be.empty;
    });

    it("rejects when non-owner tries to remove a trusted provisioner", async () => {
      await prepaidCardMarketV2
        .removeTrustedProvisioner(relayer, { from: issuer }) // from is just something else than the owner
        .should.be.rejectedWith(Error, "caller is not the owner");
    });
  });

  describe("manage balance", () => {
    describe("send tokens", () => {
      it(`can send tokens to the balance`, async function () {
        let {
          safeTx,
          executionResult: { success },
        } = await depositTokens(toTokenUnit(5));

        expect(success).to.be.true;

        expect(
          await prepaidCardMarketV2.balance(depot.address, daicpxdToken.address)
        ).to.be.bignumber.equal(toTokenUnit(5));

        expect(await prepaidCardMarketV2.issuers(depot.address)).to.be.equal(
          issuer
        );

        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_DEPOSIT_TOKENS,
          prepaidCardMarketV2.address
        );

        expect(event.issuer).to.be.equal(issuer);
        expect(event.token).to.be.equal(daicpxdToken.address);
        expect(event.amount).to.be.equal(toWei("5"));
        expect(event.safe).to.be.equal(depot.address);
      });
    });

    describe("withdraw tokens", () => {
      it("can withdraw tokens", async function () {
        await depositTokens(toTokenUnit(5));

        let {
          safeTx,
          executionResult: { success },
        } = await withdrawTokens(toTokenUnit(4));

        expect(success).to.be.true;
        expect(
          await prepaidCardMarketV2.balance(depot.address, daicpxdToken.address)
        ).to.be.bignumber.equal(toTokenUnit(1)); // We started with 5 and we withdrew 4

        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_TOKENS_WITHDRAWN,
          prepaidCardMarketV2.address
        );

        expect(event.issuer).to.be.equal(issuer);
        expect(event.token).to.be.equal(daicpxdToken.address);
        expect(event.amount).to.be.equal(toWei("4"));
        expect(event.safe).to.be.equal(depot.address);
      });

      it("fails when there is no issuer", async function () {
        // The failure happens when we want to withdraw when no deposit has been made yet
        let withdrawTokens =
          prepaidCardMarketV2.contract.methods.withdrawTokens(
            toTokenUnit(5),
            daicpxdToken.address
          );

        // We're using call (https://web3js.readthedocs.io/en/v1.2.4/web3-eth-contract.html#methods-mymethod-call)
        // which is simulating a gnosis safe transaction - it doesn't change the state.
        // If we actually use the real gnosis safe transactions
        // we can't see the rejection reason (problem described here: https://ethereum.stackexchange.com/questions/83528/how-can-i-get-the-revert-reason-of-a-call-in-solidity-so-that-i-can-use-it-in-th)
        // so we resort to the call and expect it to fail.
        await expect(
          withdrawTokens.call({
            from: depot.address,
          })
        ).to.be.rejectedWith("Issuer not found");
      });

      it("fails when there is no funds", async function () {
        // First send some tokens, then withdraw all, and try to do another withdraw
        let {
          executionResult: { success },
        } = await depositTokens(toTokenUnit(5));

        expect(success).to.be.true;

        // Withdraw all
        await withdrawTokens(toTokenUnit(5));

        // Try to withdraw again
        // Simulate a gnosis safe transaction - more details in the other comment regarding `call`
        withdrawTokens = prepaidCardMarketV2.contract.methods.withdrawTokens(
          toTokenUnit(5),
          daicpxdToken.address
        );

        await expect(
          withdrawTokens.call({
            from: depot.address,
          })
        ).to.be.rejectedWith("Insufficient funds for withdrawal");
      });
    });

    describe("SKUs", () => {
      it("can add a SKU", async function () {
        await depositTokens(toTokenUnit(1));

        let [fundingPrepaidCard] = await makePrepaidCards(
          [toTokenUnit(1)],
          ZERO_ADDRESS,
          depot.address
        );

        await cardcpxdToken.mint(fundingPrepaidCard.address, toTokenUnit(1));

        let startingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingPrepaidCard.address
        );

        let safeTx = await addPrepaidCardSKU(
          prepaidCardManager,
          fundingPrepaidCard,
          "1000",
          "did:cardstack:test",
          daicpxdToken.address,
          prepaidCardMarketV2,
          issuer,
          relayer,
          null,
          null,
          depot
        );

        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_SKU_ADDED,
          prepaidCardMarketV2.address
        );
        let [safeEvent] = getParamsFromEvent(
          safeTx,
          eventABIs.EXECUTION_SUCCESS,
          fundingPrepaidCard.address
        );

        expect(event.issuer).to.be.equal(issuer);
        expect(event.token).to.be.equal(daicpxdToken.address);
        expect(event.faceValue).to.be.equal("1000");
        expect(event.customizationDID).to.be.equal("did:cardstack:test");

        let endingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingPrepaidCard.address
        );
        expect(parseInt(safeEvent.payment)).to.be.greaterThan(0);
        expect(
          startingFundingCardBalance.sub(endingFundingCardBalance).toString()
        ).to.equal(safeEvent.payment, "prepaid card paid actual cost of gas");
      });

      it("can't add a SKU when issuer has no balance", async function () {
        let [fundingPrepaidCard] = await makePrepaidCards(
          [toTokenUnit(1)],
          ZERO_ADDRESS,
          depot.address
        );

        await addPrepaidCardSKU(
          prepaidCardManager,
          fundingPrepaidCard,
          "1000",
          "did:cardstack:test",
          daicpxdToken.address,
          prepaidCardMarketV2,
          issuer,
          relayer,
          null,
          null,
          depot
        ).should.be.rejectedWith(
          Error,
          // the real revert reason ("Issuer has no balance") is behind the
          // gnosis safe execTransaction boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });
    });

    describe("getQuantity", () => {
      it("can get the quantity of a SKU", async function () {
        await depositTokens(toTokenUnit(500)); // 500 daicpxd = 500 USD
        let [fundingPrepaidCard] = await makePrepaidCards(
          [toTokenUnit(1)],
          ZERO_ADDRESS,
          depot.address
        );

        let safeTx = await addPrepaidCardSKU(
          prepaidCardManager,
          fundingPrepaidCard,
          "1000",
          "did:cardstack:test",
          daicpxdToken.address,
          prepaidCardMarketV2,
          issuer,
          relayer,
          null,
          null,
          depot
        );

        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_SKU_ADDED,
          prepaidCardMarketV2.address
        );

        let quantity = await prepaidCardMarketV2.getQuantity(event.sku);
        expect(quantity).to.be.bignumber.eq("49");
      });
    });

    describe("Asks", () => {
      it("can set the asking price for a sku", async function () {
        await depositTokens(toTokenUnit(1));

        let [fundingPrepaidCard] = await makePrepaidCards(
          [toTokenUnit(10)],
          ZERO_ADDRESS,
          depot.address
        );

        await cardcpxdToken.mint(fundingPrepaidCard.address, toTokenUnit(1));

        let addSKUTx = await addPrepaidCardSKU(
          prepaidCardManager,
          fundingPrepaidCard,
          "1000",
          "did:cardstack:test",
          daicpxdToken.address,
          prepaidCardMarketV2,
          issuer,
          relayer,
          null,
          null,
          depot
        );

        let [skuAddedEvent] = getParamsFromEvent(
          addSKUTx,
          eventABIs.PREPAID_CARD_MARKET_V2_SKU_ADDED,
          prepaidCardMarketV2.address
        );

        let startingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingPrepaidCard.address
        );

        let safeTx = await setPrepaidCardAsk(
          prepaidCardManager,
          fundingPrepaidCard,
          10,
          skuAddedEvent.sku,
          prepaidCardMarketV2,
          issuer,
          relayer
        );

        let [askSetEvent] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_ASK_SET,
          prepaidCardMarketV2.address
        );

        let [safeEvent] = getParamsFromEvent(
          safeTx,
          eventABIs.EXECUTION_SUCCESS,
          fundingPrepaidCard.address
        );

        expect(askSetEvent.issuer).to.be.equal(issuer);
        expect(askSetEvent.issuingToken).to.be.equal(daicpxdToken.address);
        expect(askSetEvent.sku).to.be.equal(skuAddedEvent.sku);
        expect(askSetEvent.askPrice).to.be.equal("10");

        expect(
          (await prepaidCardMarketV2.asks(skuAddedEvent.sku)).toString()
        ).to.equal("10");

        let endingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingPrepaidCard.address
        );
        expect(parseInt(safeEvent.payment)).to.be.greaterThan(0);
        expect(
          startingFundingCardBalance.sub(endingFundingCardBalance).toString()
        ).to.equal(safeEvent.payment, "prepaid card paid actual cost of gas");
      });

      it("should reject when when the sku is not owned by issuer", async function () {
        await depositTokens(toTokenUnit(1));
        let [customerCard] = await makePrepaidCards([toTokenUnit(10)]);

        let addSKUTx = await addPrepaidCardSKU(
          prepaidCardManager,
          customerCard,
          "1000",
          "did:cardstack:test",
          daicpxdToken.address,
          prepaidCardMarketV2,
          issuer,
          relayer,
          null,
          null,
          depot
        );

        let [skuAddedEvent] = getParamsFromEvent(
          addSKUTx,
          eventABIs.PREPAID_CARD_MARKET_V2_SKU_ADDED,
          prepaidCardMarketV2.address
        );

        await transferOwner(
          prepaidCardManager,
          customerCard,
          issuer,
          customer,
          relayer
        );

        await setPrepaidCardAsk(
          prepaidCardManager,
          customerCard,
          10,
          skuAddedEvent.sku,
          prepaidCardMarket,
          customer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });
    });
  });

  describe("Create prepaid card", () => {
    let skuAddEvent;

    beforeEach(async function () {
      await depositTokens(toTokenUnit(100));

      let [fundingPrepaidCard] = await makePrepaidCards(
        [toTokenUnit(10)],
        ZERO_ADDRESS,
        depot.address
      );

      await cardcpxdToken.mint(fundingPrepaidCard.address, toTokenUnit(1));

      let addSKUTx = await addPrepaidCardSKU(
        prepaidCardManager,
        fundingPrepaidCard,
        "5000",
        "did:cardstack:test",
        daicpxdToken.address,
        prepaidCardMarketV2,
        issuer,
        relayer,
        null,
        null,
        depot
      );

      [skuAddEvent] = getParamsFromEvent(
        addSKUTx,
        eventABIs.PREPAID_CARD_MARKET_V2_SKU_ADDED,
        prepaidCardMarketV2.address
      );

      await setPrepaidCardAsk(
        prepaidCardManager,
        fundingPrepaidCard,
        10,
        skuAddEvent.sku,
        prepaidCardMarketV2,
        issuer,
        relayer
      );
    });

    it("can provision a prepaid card", async function () {
      // relay server will call this function
      let tx = await prepaidCardMarketV2.provisionPrepaidCard(
        customer,
        skuAddEvent.sku,
        {
          from: relayer,
        }
      );

      let [createPrepaidCardEvent] = getParamsFromEvent(
        tx,
        eventABIs.CREATE_PREPAID_CARD,
        prepaidCardManager.address
      );

      let [provisionPrepaidCardEvent] = getParamsFromEvent(
        tx,
        eventABIs.PREPAID_CARD_MARKET_V2_PREPAID_CARD_PROVISIONED,
        prepaidCardMarketV2.address
      );

      let balance = await prepaidCardMarketV2.balance(
        depot.address,
        daicpxdToken.address
      );

      // 5000 spend tokens = 50 xdai
      // balance should be toTokenUnits(100 - 50) - 100 (100 is a constant fee added in priceForFaceValue)
      expect(balance).to.be.bignumber.eq("49999999999999999900");

      expect(
        (await daicpxdToken.balanceOf(createPrepaidCardEvent.card)).toString()
      ).to.equal("50000000000000000100");

      expect(
        await prepaidCardManager.getPrepaidCardOwner(
          createPrepaidCardEvent.card
        )
      ).to.equal(customer);

      expect(provisionPrepaidCardEvent.owner).to.eq(customer);
      expect(provisionPrepaidCardEvent.sku).to.eq(skuAddEvent.sku);
    });

    it("can't provision a prepaid card when there is not enough funds", async function () {
      await withdrawTokens(toTokenUnit(100));

      await expect(
        prepaidCardMarketV2.contract.methods
          .provisionPrepaidCard(customer, skuAddEvent.sku)
          .call({
            from: relayer,
          })
      ).to.be.rejectedWith("Not enough balance");
    });

    it(`rejects when contract is paused`, async function () {
      let tx = await prepaidCardMarketV2.setPaused(true);
      let [pauseToggledEvent] = getParamsFromEvent(
        tx,
        eventABIs.PREPAID_CARD_MARKET_V2_PAUSED_TOGGLED,
        prepaidCardMarketV2.address
      );
      expect(pauseToggledEvent.paused).to.be.true;

      await prepaidCardMarketV2
        .provisionPrepaidCard(customer, skuAddEvent.sku, {
          from: relayer,
        })
        .should.be.rejectedWith(Error, "Contract is paused");
    });

    it("can provision a prepaid card when unpaused", async function () {
      await prepaidCardMarketV2.setPaused(true);
      await prepaidCardMarketV2.setPaused(false);
      let tx = await prepaidCardMarketV2.provisionPrepaidCard(
        customer,
        skuAddEvent.sku,
        {
          from: relayer,
        }
      );

      let [createPrepaidCardEvent] = getParamsFromEvent(
        tx,
        eventABIs.CREATE_PREPAID_CARD,
        prepaidCardManager.address
      );

      expect(createPrepaidCardEvent.card).to.be.ok;
    });
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await prepaidCardMarketV2.cardpayVersion()).to.equal("1.0.0");
      expect(await addPrepaidCardSKUHandler.cardpayVersion()).to.equal("1.0.0");
    });
  });
});
