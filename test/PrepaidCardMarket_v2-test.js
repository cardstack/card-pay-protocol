const ERC677Token = artifacts.require("ERC677Token.sol");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const PrepaidCardMarketV2 = artifacts.require("PrepaidCardMarketV2");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const utils = require("./utils/general");
const { INVALID_OWNER_PROVIDED } = utils.gnosisErrors;
const eventABIs = require("./utils/constant/eventABIs");

const { ZERO_ADDRESS, getParamsFromEvent, signSafeTransaction } = utils;
const { expect, TOKEN_DETAIL_DATA } = require("./setup");

const {
  toTokenUnit,
  setupExchanges,
  createPrepaidCards,
  createDepotFromSupplierMgr,
  setPrepaidCardInventory,
  transferOwner,
  removePrepaidCardInventory,
  setPrepaidCardAsk,
  splitPrepaidCard,
  setupVersionManager,
  signAndSendSafeTransaction,
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
    customer,
    provisioner,
    prepaidCardManager,
    prepaidCardMarket,
    prepaidCardMarketV2,
    versionManager,
    depot;

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    customer = accounts[2];
    relayer = accounts[3];
    provisioner = accounts[4];
    prepaidCardMarket = accounts[5];

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
      it.only(`can send tokens to the balance`, async function () {
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
          eventABIs.PREPAID_CARD_MANAGER_V2_ADD_INVENTORY,
          prepaidCardMarketV2.address
        );

        expect(event.issuer).to.be.equal(issuer);
        expect(event.token).to.be.equal(daicpxdToken.address);
        expect(event.amount).to.be.equal(toWei("5"));
        expect(event.safe).to.be.equal(depot.address);
      });
    });
  });
});
