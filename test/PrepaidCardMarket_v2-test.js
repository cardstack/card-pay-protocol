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
    depot;

  before(async () => {
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
  });

  describe("manage inventory", () => {
    describe("send tokens", () => {
      it(`can send tokens to the balance`, async function () {
        let transferAndCall = daicpxdToken.contract.methods.transferAndCall(
          prepaidCardMarketV2.address,
          toTokenUnit(5),
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
      it.only("can withdraw tokens", async function () {
        // START SETTING THE BALANCE - is there a more direct way?
        let transferAndCall = daicpxdToken.contract.methods.transferAndCall(
          prepaidCardMarketV2.address,
          toTokenUnit(5),
          AbiCoder.encodeParameters(["address"], [issuer])
        );

        let transferPayload = transferAndCall.encodeABI();
        let transferGasEstimate = await transferAndCall.estimateGas({
          from: depot.address,
        });

        await signAndSendSafeTransaction(
          {
            to: daicpxdToken.address,
            data: transferPayload,
            txGasEstimate: transferGasEstimate,
            gasPrice: 1000000000,
            txGasToken: daicpxdToken.address,
            refundReceiver: relayer,
          },
          issuer,
          depot,
          relayer
        );
        // END SETTING THE BALANCE

        let withdrawTokens =
          prepaidCardMarketV2.contract.methods.withdrawTokens(
            toTokenUnit(4),
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
        expect(
          await prepaidCardMarketV2.balance(depot.address, daicpxdToken.address)
        ).to.be.bignumber.equal(toTokenUnit(1)); // We withdrew 4 tokens, started with 5

        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.PREPAID_CARD_MARKET_V2_REMOVE_INVENTORY,
          prepaidCardMarketV2.address
        );

        expect(event.issuer).to.be.equal(issuer);
        expect(event.token).to.be.equal(daicpxdToken.address);
        expect(event.amount).to.be.equal(toWei("4"));
        expect(event.safe).to.be.equal(depot.address);
      });

      it.only("fails when there is no balance", async function () {
        let withdrawTokens =
          prepaidCardMarketV2.contract.methods.withdrawTokens(
            toTokenUnit(100),
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

        // FIXME: the VM exception happens but it's not caught by the test
        // error: VM Exception while processing transaction: reverted with reason string 'Insufficient funds for withdrawal'
        await expect(
          signAndSendSafeTransaction(safeTxData, issuer, depot, relayer)
        ).to.be.reverted;
      });
    });
  });
});
