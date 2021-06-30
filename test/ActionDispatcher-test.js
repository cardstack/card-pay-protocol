const ERC677Token = artifacts.require("ERC677Token.sol");
const RevenuePool = artifacts.require("RevenuePool.sol");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const AbiCoder = require("web3-eth-abi");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const MerchantManager = artifacts.require("MerchantManager");

const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");

const { ZERO_ADDRESS, getParamsFromEvent } = utils;
const { expect, TOKEN_DETAIL_DATA } = require("./setup");

const {
  toTokenUnit,
  setupExchanges,
  createPrepaidCards,
  transferOwner,
  addActionHandlers,
  createDepotFromSupplierMgr,
} = require("./utils/helper");

contract("Action Dispatcher", (accounts) => {
  let daicpxdToken,
    cardcpxdToken,
    revenuePool,
    spendToken,
    fakeToken,
    issuer,
    owner,
    relayer,
    merchant,
    exchange,
    payMerchantHandler,
    merchantManager,
    actionDispatcher,
    registerMerchantHandler,
    customer,
    proxyFactory,
    gnosisSafeMasterCopy,
    prepaidCardManager,
    depot;

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    merchant = accounts[2];
    customer = accounts[3];
    relayer = accounts[5];
    let merchantFeeReceiver = accounts[6];

    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await utils.deployContract(
      "deploying Gnosis Safe Mastercopy",
      GnosisSafe
    );

    revenuePool = await RevenuePool.new();
    await revenuePool.initialize(owner);
    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);
    let supplierManager = await SupplierManager.new();
    await supplierManager.initialize(owner);
    spendToken = await SPEND.new();
    await spendToken.initialize(owner);
    actionDispatcher = await ActionDispatcher.new();
    await actionDispatcher.initialize(owner);
    let tokenManager = await TokenManager.new();
    await tokenManager.initialize(owner);
    merchantManager = await MerchantManager.new();
    await merchantManager.initialize(owner);

    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));

    await daicpxdToken.mint(owner, toTokenUnit(100));
    fakeToken = await ERC677Token.new();
    await fakeToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await fakeToken.mint(owner, toTokenUnit(100));

    await prepaidCardManager.setup(
      tokenManager.address,
      supplierManager.address,
      exchange.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      actionDispatcher.address,
      ZERO_ADDRESS,
      0,
      cardcpxdToken.address,
      100,
      500000
    );
    await prepaidCardManager.addGasPolicy("transfer", false, true);
    await prepaidCardManager.addGasPolicy("split", true, true);

    await tokenManager.setup(ZERO_ADDRESS, [
      daicpxdToken.address,
      cardcpxdToken.address,
    ]);

    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address
    );

    ({ payMerchantHandler, registerMerchantHandler } = await addActionHandlers(
      prepaidCardManager,
      revenuePool,
      actionDispatcher,
      merchantManager,
      owner,
      exchange.address,
      spendToken.address
    ));
    await spendToken.addMinter(payMerchantHandler.address);

    await revenuePool.setup(
      exchange.address,
      merchantManager.address,
      actionDispatcher.address,
      prepaidCardManager.address,
      merchantFeeReceiver,
      0,
      1000
    );
    await merchantManager.setup(
      actionDispatcher.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address
    );
    await supplierManager.setup(
      ZERO_ADDRESS,
      gnosisSafeMasterCopy.address,
      proxyFactory.address
    );
    depot = await createDepotFromSupplierMgr(supplierManager, issuer);
    await daicpxdToken.mint(depot.address, toTokenUnit(1000));
  });

  describe("action handlers", () => {
    it("allows the owner to remove an action handler", async () => {
      await actionDispatcher.removeHandler("payMerchant");
      expect(
        await actionDispatcher.isHandler(payMerchantHandler.address)
      ).to.equal(false);
      expect(await actionDispatcher.actions("payMerchant")).to.equal(
        ZERO_ADDRESS
      );

      // reset the revenue pool state for the other tests
      await actionDispatcher.addHandler(
        payMerchantHandler.address,
        "payMerchant"
      );
    });

    it("does not allow a non owner to add a handler", async () => {
      await actionDispatcher
        .addHandler(exchange.address, "badHandler", { from: merchant })
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });

    it("does not allow a non owner to remove a handler", async () => {
      await actionDispatcher
        .removeHandler("payMerchant", { from: merchant })
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });

    it("does not allow a non owner to call setup() on PayMerchantHandler", async () => {
      await payMerchantHandler
        .setup(
          actionDispatcher.address,
          merchantManager.address,
          prepaidCardManager.address,
          revenuePool.address,
          spendToken.address,
          { from: merchant }
        )
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });

    it("does not allow a non owner to call setup() on RegisterMerchantHandler", async () => {
      await registerMerchantHandler
        .setup(
          actionDispatcher.address,
          merchantManager.address,
          revenuePool.address,
          exchange.address,
          { from: merchant }
        )
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });

    it("does not allow PayMerchantHandler to receive tokens from non-action dispatcher", async () => {
      // setup merchant safe
      let merchantTx = await merchantManager.registerMerchant(merchant, "");
      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        merchantManager.address
      );
      let merchantSafe = merchantCreation[0]["merchantSafe"];

      // setup customer prepaid card
      let {
        prepaidCards: [prepaidCard],
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
        prepaidCard,
        issuer,
        customer,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      daicpxdToken.mint(merchant, toTokenUnit(1));

      // emulate a real pay merchant action
      await daicpxdToken
        .transferAndCall(
          payMerchantHandler.address,
          toTokenUnit(1),
          AbiCoder.encodeParameters(
            ["address", "uint256", "string", "bytes"],
            [
              prepaidCard.address,
              100,
              "payMerchant",
              AbiCoder.encodeParameters(["address"], [merchantSafe]),
            ]
          ),
          { from: merchant }
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it("does not allow RegisterMerchantHandler to receive tokens from non-action dispatcher", async () => {
      // setup a customer prepaid card
      let {
        prepaidCards: [prepaidCard],
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
        prepaidCard,
        issuer,
        customer,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      daicpxdToken.mint(customer, toTokenUnit(10));

      // emulate a real register merchant action
      await daicpxdToken
        .transferAndCall(
          registerMerchantHandler.address,
          toTokenUnit(10),
          AbiCoder.encodeParameters(
            ["address", "uint256", "string", "bytes"],
            [
              prepaidCard.address,
              1000,
              "registerMerchant",
              AbiCoder.encodeParameters(["string"], [""]),
            ]
          ),
          { from: customer }
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await actionDispatcher.cardpayVersion()).to.match(/\d\.\d\.\d/);
    });
  });
});
