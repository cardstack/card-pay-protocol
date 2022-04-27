const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const PrepaidCardMarketV2 = artifacts.require("PrepaidCardMarketV2");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");

const { ZERO_ADDRESS, getParamsFromEvent } = utils;
const { expect } = require("./setup");

const {
  toTokenUnit,
  setupExchanges,
  createDepotFromSupplierMgr,
  setupVersionManager,
  signAndSendSafeTransaction,
} = require("./utils/helper");

const AbiCoder = require("web3-eth-abi");
const { toWei } = require("web3-utils");

contract("PrepaidCardMarketV2", (accounts) => {
  let daicpxdToken,
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
    setAsk,
    addSKU;

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
    let tokenManager = await TokenManager.new();
    await tokenManager.initialize(owner);

    let cardcpxdToken;
    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));

    await daicpxdToken.mint(owner, toTokenUnit(100));

    await tokenManager.setup(
      ZERO_ADDRESS,
      [daicpxdToken.address, cardcpxdToken.address],
      versionManager.address
    );

    await supplierManager.setup(
      ZERO_ADDRESS,
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

    await prepaidCardMarketV2.setup(
      exchange.address,
      prepaidCardManager.address,
      provisioner,
      tokenManager.address,
      [relayer],
      versionManager.address
    );

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

    addSKU = async (faceValue, did) => {
      let addSku = prepaidCardMarketV2.contract.methods.addSKU(
        faceValue,
        did,
        daicpxdToken.address
      );

      let gasEstimate = await addSku.estimateGas({
        from: depot.address,
      });

      let safeTxData = {
        to: prepaidCardMarketV2.address,
        data: addSku.encodeABI(),
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

    setAsk = async (issuerAddress, sku, askPrice) => {
      let setAsk = prepaidCardMarketV2.contract.methods.setAsk(
        issuerAddress,
        sku,
        askPrice
      );

      let gasEstimate = await setAsk.estimateGas({
        from: depot.address,
      });

      let safeTxData = {
        to: prepaidCardMarketV2.address,
        data: setAsk.encodeABI(),
        txGasEstimate: gasEstimate,
        gasPrice: 1000000000,
        txGasToken: daicpxdToken.address,
        refundReceiver: relayer,
      };

      return await signAndSendSafeTransaction(
        safeTxData,
        issuerAddress,
        depot,
        relayer
      );
    };
  });

  describe("setup", () => {
    it("should set trusted provisioners", async () => {
      await prepaidCardMarketV2.setup(
        exchange.address,
        prepaidCardManager.address,
        provisioner,
        (
          await TokenManager.new()
        ).address,
        [relayer],
        versionManager.address
      );
      expect(
        await prepaidCardMarketV2.getTrustedProvisioners()
      ).to.have.members([relayer]);
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

        let {
          safeTx,
          executionResult: { success },
        } = await addSKU("1000", "did:cardstack:test", daicpxdToken.address);

        expect(success).to.be.true;

        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_SKU_ADDED,
          prepaidCardMarketV2.address
        );

        expect(event.issuer).to.be.equal(issuer);
        expect(event.token).to.be.equal(daicpxdToken.address);
        expect(event.faceValue).to.be.equal("1000");
        expect(event.customizationDID).to.be.equal("did:cardstack:test");
      });
    });

    describe("getQuantity", () => {
      it("can get the quantity of a SKU", async function () {
        await depositTokens(toTokenUnit(500)); // 500 daicpxd = 500 USD

        let { safeTx } = await addSKU(
          "5000", // 50 USD
          "did:cardstack:test",
          daicpxdToken.address
        );

        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_SKU_ADDED,
          prepaidCardMarketV2.address
        );

        let quantity = await prepaidCardMarketV2.getQuantity(event.sku);
        expect(quantity).to.be.bignumber.eq("9"); // Because of fees, we can only buy 9 cards and not 10
      });
    });

    describe("Asks", () => {
      it("can set an ask price", async function () {
        await depositTokens(toTokenUnit(5));
        let { safeTx: addSkuSafeTx } = await addSKU(
          "5000",
          "did:cardstack:test",
          daicpxdToken.address
        );
        let [skuEvent] = getParamsFromEvent(
          addSkuSafeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_SKU_ADDED,
          prepaidCardMarketV2.address
        );

        let {
          safeTx: prepaidCardCreateSafeTx,
          executionResult: { success },
        } = await setAsk(issuer, skuEvent.sku, 10);

        expect(success).to.be.true;

        let [event] = getParamsFromEvent(
          prepaidCardCreateSafeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_ASK_SET,
          prepaidCardMarketV2.address
        );

        expect(event.issuer).to.be.equal(issuer);
        expect(event.issuingToken).to.be.equal(daicpxdToken.address);
        expect(event.sku).to.be.equal(skuEvent.sku);
        expect(event.askPrice).to.be.equal("10");
      });
    });
  });

  describe("Create prepaid card", () => {
    let skuAddEvent;

    beforeEach(async function () {
      await depositTokens(toTokenUnit(100));

      let { safeTx } = await addSKU(
        "5000",
        "did:cardstack:test",
        daicpxdToken.address
      );

      [skuAddEvent] = getParamsFromEvent(
        safeTx,
        eventABIs.PREPAID_CARD_MARKET_V2_SKU_ADDED,
        prepaidCardMarketV2.address
      );

      await setAsk(issuer, skuAddEvent.sku, 10); // Doesn't play a role here, we just need to set something which is > 0
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
    });

    it(`rejects when contract is paused`, async function () {
      await prepaidCardMarketV2.setPaused(true);
      await prepaidCardMarketV2
        .provisionPrepaidCard(customer, skuAddEvent.sku, {
          from: relayer,
        })
        .should.be.rejectedWith(Error, "Contract is paused");
    });
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await prepaidCardMarketV2.cardpayVersion()).to.equal("1.0.0");
    });
  });
});
