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
    prepaidCardManager,
    prepaidCardMarket,
    prepaidCardMarketV2,
    versionManager,
    depot,
    depositTokens,
    withdrawTokens,
    addSKU;

  beforeEach(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    relayer = accounts[4];
    provisioner = accounts[5];
    prepaidCardMarket = accounts[6];

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

    let exchange, cardcpxdToken;
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
      versionManager.address
    );

    await prepaidCardMarketV2.setup(
      prepaidCardManager.address,
      provisioner,
      tokenManager.address,
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

      await signAndSendSafeTransaction(safeTxData, issuer, depot, relayer);
    };
  });
  });

  describe("manage inventory", () => {
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

        expect(await prepaidCardMarketV2.issuer(depot.address)).to.be.equal(
          issuer
        );

        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_ADD_INVENTORY,
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
          eventABIs.PREPAID_CARD_MARKET_V2_REMOVE_INVENTORY,
          prepaidCardMarketV2.address
        );

        expect(event.issuer).to.be.equal(issuer);
        expect(event.token).to.be.equal(daicpxdToken.address);
        expect(event.amount).to.be.equal(toWei("4"));
        expect(event.safe).to.be.equal(depot.address);

        // todo check the balance of the depot
      });

      it("fails when there is no issuer", async function () {
        // This happens when we want to withdraw when no deposit has been made yet (which would set the issuer to 0)

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
        // First send some tokens, then withdraw all and try to do another withdraw
        let {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          safeTx,
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

        let addSku = prepaidCardMarketV2.contract.methods.addSKU(
          "1000",
          "did:cardstack:test",
          daicpxdToken.address
        );

        let payload = addSku.encodeABI();

        let gasEstimate = await addSku.estimateGas({
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

        let {
          safeTx,
          executionResult: { success },
        } = await signAndSendSafeTransaction(
          safeTxData,
          issuer,
          depot,
          relayer
        );

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
      it.only("can get the quantity of a SKU", async function () {
        await depositTokens(toTokenUnit(500));
        await addSKU("5000", "did:cardstack:test", daicpxdToken.address);
        let quantity = await prepaidCardMarketV2.getQuantity(
          "0xc98d1de40e4e64f3553b816a7c583e14f788b2bdfd87eac366f5597b63bb18f9"
        );
        expect(quantity).to.equal("9");
      });
    });

    describe("Asks", () => {
      it.only("can set an ask price", async function () {
        await depositTokens(toTokenUnit(5));

        // Add SKU
        let addSku = prepaidCardMarketV2.contract.methods.addSKU(
          "5000",
          "did:cardstack:test",
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

        await signAndSendSafeTransaction(safeTxData, issuer, depot, relayer);

        // End adding SKU

        let setAsk = prepaidCardMarketV2.contract.methods.setAsk(
          issuer,
          "0xc98d1de40e4e64f3553b816a7c583e14f788b2bdfd87eac366f5597b63bb18f9",
          10
        );

        gasEstimate = await setAsk.estimateGas({
          from: depot.address,
        });

        safeTxData = {
          to: prepaidCardMarketV2.address,
          data: setAsk.encodeABI(),
          txGasEstimate: gasEstimate,
          gasPrice: 1000000000,
          txGasToken: daicpxdToken.address,
          refundReceiver: relayer,
        };

        let {
          safeTx,
          executionResult: { success },
        } = await signAndSendSafeTransaction(
          safeTxData,
          issuer,
          depot,
          relayer
        );

        expect(success).to.be.true;

        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_ASK_SET,
          prepaidCardMarketV2.address
        );

        expect(event.issuer).to.be.equal(issuer);
        expect(event.issuingToken).to.be.equal(daicpxdToken.address);
        expect(event.sku).to.be.equal(
          "0xc98d1de40e4e64f3553b816a7c583e14f788b2bdfd87eac366f5597b63bb18f9"
        );
        expect(event.askPrice).to.be.equal("10");
      });
    });
  });
});
