const ERC677Token = artifacts.require("ERC677Token.sol");
const RevenuePool = artifacts.require("RevenuePool.sol");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const MerchantManager = artifacts.require("MerchantManager");
const DeprecatedMerchantManager = artifacts.require(
  "DeprecatedMerchantManager"
);

const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");

const { ZERO_ADDRESS, getParamsFromEvent } = utils;
const { expect, TOKEN_DETAIL_DATA } = require("./setup");

const {
  toTokenUnit,
  setupExchanges,
  createPrepaidCards,
  registerMerchant,
  transferOwner,
  addActionHandlers,
  createDepotFromSupplierMgr,
} = require("./utils/helper");

contract(
  "DeprecatedMerchantManager - remove after merchant safes upgraded in mainnet",
  (accounts) => {
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
      actionDispatcher,
      merchantManager,
      deprecatedMerchantManager,
      merchantSafe,
      merchantFeeReceiver,
      proxyFactory,
      gnosisSafeMasterCopy,
      prepaidCardManager,
      depot;

    before(async () => {
      owner = accounts[0];
      issuer = accounts[1];
      merchant = accounts[2];
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
      deprecatedMerchantManager = await DeprecatedMerchantManager.new();
      await deprecatedMerchantManager.initialize(owner);

      ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));

      await daicpxdToken.mint(owner, toTokenUnit(100));
      fakeToken = await ERC677Token.new();
      await fakeToken.initialize(...TOKEN_DETAIL_DATA, owner);
      await fakeToken.mint(owner, toTokenUnit(100));

      await tokenManager.setup(ZERO_ADDRESS, [
        daicpxdToken.address,
        cardcpxdToken.address,
      ]);

      await supplierManager.setup(
        ZERO_ADDRESS,
        gnosisSafeMasterCopy.address,
        proxyFactory.address
      );
      await deprecatedMerchantManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address
      );
      await merchantManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        deprecatedMerchantManager.address
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
        cardcpxdToken.address,
        100,
        500000
      );
      await prepaidCardManager.addGasPolicy("transfer", false, true);
      await prepaidCardManager.addGasPolicy("split", true, true);

      await actionDispatcher.setup(
        tokenManager.address,
        exchange.address,
        prepaidCardManager.address
      );

      ({ payMerchantHandler } = await addActionHandlers(
        prepaidCardManager,
        revenuePool,
        actionDispatcher,
        deprecatedMerchantManager,
        tokenManager,
        owner,
        exchange.address,
        spendToken.address
      ));
      await spendToken.addMinter(payMerchantHandler.address);

      depot = await createDepotFromSupplierMgr(supplierManager, issuer);
      await daicpxdToken.mint(depot.address, toTokenUnit(1000));
    });

    describe("upgrade merchant safe", () => {
      beforeEach(async () => {
        await revenuePool.setup(
          exchange.address,
          deprecatedMerchantManager.address,
          actionDispatcher.address,
          prepaidCardManager.address,
          merchantFeeReceiver,
          0,
          1000
        );
      });

      it("a merchant safe can be upgraded to the latest MerchantManager", async () => {
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
        await cardcpxdToken.mint(merchantPrepaidCard.address, toTokenUnit(1));
        await transferOwner(
          prepaidCardManager,
          merchantPrepaidCard,
          issuer,
          merchant,
          cardcpxdToken,
          relayer,
          daicpxdToken
        );
        let merchantTx = await registerMerchant(
          prepaidCardManager,
          merchantPrepaidCard,
          daicpxdToken,
          cardcpxdToken,
          relayer,
          merchant,
          1000,
          undefined,
          "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
        );
        let merchantCreation = await getParamsFromEvent(
          merchantTx,
          eventABIs.MERCHANT_CREATION,
          deprecatedMerchantManager.address
        );
        merchantSafe = merchantCreation[0]["merchantSafe"];

        expect(
          (await deprecatedMerchantManager.merchants(merchant)).merchantSafe
        ).to.equal(merchantSafe);
        expect(
          await deprecatedMerchantManager.merchantSafes(merchantSafe)
        ).to.equal(merchant);
        expect(
          await deprecatedMerchantManager.isMerchantSafe(merchantSafe)
        ).to.equal(true);
        expect(
          (await deprecatedMerchantManager.merchants(merchant)).infoDID
        ).to.equal("did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49");

        await merchantManager.upgradeMerchantSafe(merchantSafe);

        expect(
          await merchantManager.merchantSafesForMerchant(merchant)
        ).to.deep.equal([merchantSafe]);
        expect(await merchantManager.merchantSafes(merchantSafe)).to.equal(
          merchant
        );
        expect(await merchantManager.isMerchantSafe(merchantSafe)).to.equal(
          true
        );
        expect(
          await merchantManager.merchantSafeInfoDIDs(merchantSafe)
        ).to.equal("did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49");
      });
    });
  }
);
