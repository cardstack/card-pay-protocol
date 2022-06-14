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
const BridgeUtils = artifacts.require("BridgeUtils");

const utils = require("./utils/general");
const { SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET, INVALID_OWNER_PROVIDED } =
  utils.gnosisErrors;
const eventABIs = require("./utils/constant/eventABIs");

const { ZERO_ADDRESS, getParamsFromEvent, signSafeTransaction } = utils;
const { expect, TOKEN_DETAIL_DATA, assert } = require("./setup");
const { BN, fromWei, toBN, toWei } = require("web3").utils;

const {
  toTokenUnit,
  shouldBeSameBalance,
  getBalance,
  signAndSendSafeTransaction,
  setupExchanges,
  createPrepaidCards,
  registerMerchant,
  transferOwner,
  payMerchant,
  addActionHandlers,
  createDepotFromSupplierMgr,
  setupVersionManager,
} = require("./utils/helper");

contract("RevenuePool", (accounts) => {
  let daicpxdToken,
    revenuePool,
    spendToken,
    fakeToken,
    issuer,
    daiFeed,
    owner,
    relayer,
    merchant,
    exchange,
    anotherMerchant,
    payMerchantHandler,
    registerMerchantHandler,
    actionDispatcher,
    customer,
    merchantManager,
    merchantSafe,
    merchantFeeReceiver,
    proxyFactory,
    gnosisSafeMasterCopy,
    versionManager,
    prepaidCardManager,
    depot;

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    merchant = accounts[2];
    customer = accounts[3];
    anotherMerchant = accounts[4];
    relayer = accounts[5];
    merchantFeeReceiver = accounts[6];

    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await utils.deployContract(
      "deploying Gnosis Safe Mastercopy",
      GnosisSafe
    );

    versionManager = await setupVersionManager(owner);
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
    let bridgeUtils = await BridgeUtils.new();
    await bridgeUtils.initialize(owner);

    let cardcpxdToken;
    ({ daiFeed, daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(
      owner
    ));

    await daicpxdToken.mint(owner, toTokenUnit(100));
    fakeToken = await ERC677Token.new();
    await fakeToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await fakeToken.mint(owner, toTokenUnit(100));

    await tokenManager.setup(
      bridgeUtils.address,
      [daicpxdToken.address, cardcpxdToken.address],
      versionManager.address
    );

    await supplierManager.setup(
      bridgeUtils.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      versionManager.address
    );
    await merchantManager.setup(
      actionDispatcher.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      [relayer],
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
      [],
      [],
      versionManager.address
    );
    await prepaidCardManager.addGasPolicy("transfer", false);
    await prepaidCardManager.addGasPolicy("split", false);

    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address,
      versionManager.address
    );

    ({ payMerchantHandler, registerMerchantHandler } = await addActionHandlers({
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

    depot = await createDepotFromSupplierMgr(supplierManager, issuer);
    await daicpxdToken.mint(depot.address, toTokenUnit(1000));
  });

  describe("initial revenue pool contract", () => {
    beforeEach(async () => {
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
    });

    it("reverts when merchantFeeReceiver is set to zero address", async () => {
      await revenuePool
        .setup(
          exchange.address,
          merchantManager.address,
          actionDispatcher.address,
          prepaidCardManager.address,
          ZERO_ADDRESS,
          0,
          1000,
          versionManager.address
        )
        .should.be.rejectedWith(Error, "merchantFeeReceiver not set");
    });

    it("reverts when merchantRegistrationFeeInSPEND is not set", async () => {
      await revenuePool
        .setup(
          exchange.address,
          merchantManager.address,
          actionDispatcher.address,
          prepaidCardManager.address,
          merchantFeeReceiver,
          0,
          0,
          versionManager.address
        )
        .should.be.rejectedWith(
          Error,
          "merchantRegistrationFeeInSPEND not set"
        );
    });

    it("reverts when non-owner calls setup()", async () => {
      await revenuePool
        .setup(
          exchange.address,
          merchantManager.address,
          actionDispatcher.address,
          prepaidCardManager.address,
          merchantFeeReceiver,
          0,
          1000,
          versionManager.address,
          { from: merchant }
        )
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });

    it("check Revenue pool parameters", async () => {
      expect(await revenuePool.merchantManager()).to.equal(
        merchantManager.address
      );
      expect(await revenuePool.merchantFeeReceiver()).to.equal(
        merchantFeeReceiver
      );
      expect((await revenuePool.merchantFeePercentage()).toString()).to.equal(
        "0"
      );
      expect(
        (await revenuePool.merchantRegistrationFeeInSPEND()).toString()
      ).to.equal("1000");
      expect(await revenuePool.prepaidCardManager()).to.equal(
        prepaidCardManager.address
      );
    });

    it("has a sane upper bound for merchantRegistrationFeeInSPEND", async () => {
      await revenuePool.setup(
        exchange.address,
        merchantManager.address,
        actionDispatcher.address,
        prepaidCardManager.address,
        merchantFeeReceiver,
        10000000,
        10000,
        versionManager.address
      );
      await revenuePool
        .setup(
          exchange.address,
          merchantManager.address,
          actionDispatcher.address,
          prepaidCardManager.address,
          merchantFeeReceiver,
          10000000,
          10001,
          versionManager.address
        )
        .should.be.rejectedWith(
          Error,
          "merchantRegistrationFeeInSPEND is above the maximum"
        );
    });

    it("has a sane upper bound for merchantFeePercentage", async () => {
      await revenuePool.setup(
        exchange.address,
        merchantManager.address,
        actionDispatcher.address,
        prepaidCardManager.address,
        merchantFeeReceiver,
        10000000,
        1000,
        versionManager.address
      );

      await revenuePool
        .setup(
          exchange.address,
          merchantManager.address,
          actionDispatcher.address,
          prepaidCardManager.address,
          merchantFeeReceiver,
          10000001,
          1000,
          versionManager.address
        )
        .should.be.rejectedWith(
          Error,
          "merchantFeePercentage is above the maximum"
        );
    });
  });

  describe("setup merchant manager", () => {
    it("should set trusted merchant registrars", async () => {
      await merchantManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        [relayer],
        versionManager.address
      );
      expect(await merchantManager.getMerchantRegistrars()).to.have.members([
        relayer,
      ]);
    });
  });

  describe("removing merchant registrars", () => {
    it("can remove merchant registrars", async () => {
      await merchantManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        [relayer],
        versionManager.address
      );
      expect(await merchantManager.getMerchantRegistrars()).to.have.members([
        relayer,
      ]);

      await merchantManager.removeMerchantRegistrar(relayer);

      expect(await merchantManager.getMerchantRegistrars()).to.be.empty;
    });
  });

  describe("create merchant", () => {
    before(async () => {
      await merchantManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        [relayer],
        versionManager.address
      );
    });

    // Warning the merchant safe created in this test is used in all the
    // subsequent tests!
    it("a merchant uses a prepaid card to register themselves", async () => {
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        merchant,
        relayer
      );
      let merchantTx = await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        relayer,
        merchant,
        1000,
        undefined,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
      );
      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        merchantManager.address
      );
      merchantSafe = merchantCreation[0]["merchantSafe"]; // Warning: this is reused in other tests

      expect(
        await merchantManager.merchantSafesForMerchant(merchant)
      ).to.deep.equal([merchantSafe]);
      expect(await merchantManager.merchantSafes(merchantSafe)).to.equal(
        merchant
      );
      expect(await merchantManager.isMerchantSafe(merchantSafe)).to.equal(true);
      expect(await merchantManager.merchantSafeInfoDIDs(merchantSafe)).to.equal(
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
      );

      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(10))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance.add(toTokenUnit(10))
      );
    });

    it("refunds the prepaid card if the merchant pays more than the registration fee", async () => {
      let _merchant = accounts[9];
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(11)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        _merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        relayer,
        _merchant,
        1100
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(10))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance.add(toTokenUnit(10))
      );
    });

    it("merchant registration does not collect the merchantFeePercentage (only the registration fee)", async () => {
      let _merchant = accounts[8];
      await revenuePool.setup(
        exchange.address,
        merchantManager.address,
        actionDispatcher.address,
        prepaidCardManager.address,
        merchantFeeReceiver,
        10000000,
        1000,
        versionManager.address
      );
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        _merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        relayer,
        _merchant,
        1000
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(10))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance.add(toTokenUnit(10))
      );

      // Reset back for the subsequent tests
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
    });

    it("reverts when a merchant doesn't send the registration fee amount", async () => {
      let _merchant = accounts[7];
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        _merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        relayer,
        _merchant,
        900
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance
      );
    });

    it("reverts when a merchant doesn't have enough in their prepaid card for the registration fee amount", async () => {
      let _merchant = accounts[7];
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(9)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        _merchant,
        relayer
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        relayer,
        _merchant,
        1000
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance
      );
    });

    it("allows merchant to register multiple merchant safes", async () => {
      // This test assumes that 'merchant' has already been registered in previous test
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantPrepaidCard.address
      );
      let startingMerchantFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
        issuer,
        merchant,
        relayer
      );
      let merchantTx = await registerMerchant(
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
      let anotherMerchantSafe = merchantCreation[0]["merchantSafe"]; // Warning: this is reused in other tests

      expect(
        await merchantManager.merchantSafesForMerchant(merchant)
      ).to.deep.equal([merchantSafe, anotherMerchantSafe]);
      expect(await merchantManager.merchantSafes(anotherMerchantSafe)).to.equal(
        merchant
      );
      expect(
        await merchantManager.isMerchantSafe(anotherMerchantSafe)
      ).to.equal(true);
      expect(
        await merchantManager.merchantSafeInfoDIDs(anotherMerchantSafe)
      ).to.equal("did:cardstack:another-merchant-safe");

      await shouldBeSameBalance(
        daicpxdToken,
        merchantPrepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(10))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        startingMerchantFeeReceiverDaicpxdBalance.add(toTokenUnit(10))
      );
    });

    it("allows the contract owner to directly add a merchant", async () => {
      let merchantTx = await merchantManager.registerMerchant(
        anotherMerchant,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49-xx",
        { from: owner }
      );
      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        merchantManager.address
      );
      let anotherMerchantSafe = merchantCreation[0]["merchantSafe"];

      expect(
        await merchantManager.merchantSafesForMerchant(anotherMerchant)
      ).to.deep.equal([anotherMerchantSafe]);
      expect(await merchantManager.merchantSafes(anotherMerchantSafe)).to.equal(
        anotherMerchant
      );
      expect(
        await merchantManager.isMerchantSafe(anotherMerchantSafe)
      ).to.equal(true);
      expect(
        await merchantManager.merchantSafeInfoDIDs(anotherMerchantSafe)
      ).to.equal("did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49-xx");
    });

    it("allows the merchant registrar to directly add a merchant", async () => {
      let merchant = accounts[10];
      let merchantTx = await merchantManager.registerMerchant(
        merchant,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49-xy",
        { from: relayer }
      );
      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        merchantManager.address
      );
      let anotherMerchantSafe = merchantCreation[0]["merchantSafe"];

      expect(
        await merchantManager.merchantSafesForMerchant(merchant)
      ).to.deep.equal([anotherMerchantSafe]);
      expect(await merchantManager.merchantSafes(anotherMerchantSafe)).to.equal(
        merchant
      );
      expect(
        await merchantManager.isMerchantSafe(anotherMerchantSafe)
      ).to.equal(true);
      expect(
        await merchantManager.merchantSafeInfoDIDs(anotherMerchantSafe)
      ).to.equal("did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49-xy");
    });

    it("rejects a non-contract owner or a non-merchant registrar directly adding a merchant", async () => {
      await merchantManager
        .registerMerchant(
          accounts[9],
          "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49",
          { from: accounts[9] }
        )
        .should.be.rejectedWith(Error, "caller is not registered");
    });

    it("reverts when a prepaid card used for registering a merchant is transferred", async () => {
      let {
        prepaidCards: [merchantPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10)]
      );
      await registerMerchant(
        prepaidCardManager,
        merchantPrepaidCard,
        relayer,
        issuer,
        1000
      );
      await transferOwner(
        prepaidCardManager,
        merchantPrepaidCard,
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
  });

  describe("disable merchant safe", () => {
    let merchantSafe;
    before(async () => {
      await merchantManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        [relayer],
        versionManager.address
      );

      let merchant = accounts[11];
      let merchantTx = await merchantManager.registerMerchant(
        merchant,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49-xz",
        { from: relayer }
      );
      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        merchantManager.address
      );
      merchantSafe = merchantCreation[0]["merchantSafe"];
    });

    afterEach(async () => {
      await merchantManager.enableSafe(merchantSafe);
      expect(await merchantManager.getDisabledMerchantSafes()).to.be.empty;
    });

    it("allows owner to disable merchant safe", async () => {
      await merchantManager.disableSafe(merchantSafe, { from: owner });
      expect(await merchantManager.getDisabledMerchantSafes()).to.have.members([
        merchantSafe,
      ]);
    });

    it("allows registrar to disable merchant safe", async () => {
      await merchantManager.disableSafe(merchantSafe, { from: relayer });
      expect(await merchantManager.getDisabledMerchantSafes()).to.have.members([
        merchantSafe,
      ]);
    });

    it("does not allow non-owner nor non-registrar to disable merchant safe", async () => {
      await merchantManager
        .disableSafe(merchantSafe, { from: accounts[11] })
        .should.be.rejectedWith(
          Error,
          "caller is not an owner nor a registrar"
        );
    });
  });

  describe("enable merchant safe", () => {
    let merchantSafe;
    before(async () => {
      await merchantManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        [relayer],
        versionManager.address
      );

      let merchant = accounts[13];
      let merchantTx = await merchantManager.registerMerchant(
        merchant,
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49-xz",
        { from: relayer }
      );
      let merchantCreation = await getParamsFromEvent(
        merchantTx,
        eventABIs.MERCHANT_CREATION,
        merchantManager.address
      );
      merchantSafe = merchantCreation[0]["merchantSafe"];
    });

    it("allows owner to enable merchant safe", async () => {
      await merchantManager.enableSafe(merchantSafe, { from: owner });
      expect(await merchantManager.getDisabledMerchantSafes()).to.be.empty;
    });

    it("allows registrar to enable merchant safe", async () => {
      await merchantManager.enableSafe(merchantSafe, { from: relayer });
      expect(await merchantManager.getDisabledMerchantSafes()).to.be.empty;
    });

    it("does not allow non-owner nor non-registrar to enable merchant safe", async () => {
      await merchantManager
        .enableSafe(merchantSafe, { from: accounts[11] })
        .should.be.rejectedWith(
          Error,
          "caller is not an owner nor a registrar"
        );
    });
  });

  describe("pay token", () => {
    let prepaidCard;
    before(async () => {
      ({
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(100)]
      ));
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        customer,
        relayer
      );
    });

    it("can pay 1 DAI CPXD token to pool and mint SPEND token to the merchant's wallet", async () => {
      let existingSPENDBalance = await getBalance(spendToken, merchantSafe);
      let existingDAIBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
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
        prepaidCard.address,
        existingDAIBalance.sub(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingSPENDBalance.add(toBN("100"))
      );
    });

    it("can pay 2 DAI CPXD token to pool and mint SPEND token to the merchant's wallet", async () => {
      let existingSPENDBalance = await getBalance(spendToken, merchantSafe);
      let existingDAIBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        merchantSafe,
        200
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAIBalance.sub(toTokenUnit(2))
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingSPENDBalance.add(toBN("200"))
      );
    });

    it("can collect merchant fees from the customer payment to the merchant", async () => {
      await revenuePool.setup(
        exchange.address,
        merchantManager.address,
        actionDispatcher.address,
        prepaidCardManager.address,
        merchantFeeReceiver,
        10000000, // 10% merchant fee
        1000,
        versionManager.address
      );
      expect((await revenuePool.merchantFeePercentage()).toString()).to.equal(
        "10000000"
      );

      let beginningMerchantSpendBalance = await getBalance(
        spendToken,
        merchantSafe
      );
      let beginningMerchantDaiClaim = BN(
        await revenuePool.revenueBalance(merchantSafe, daicpxdToken.address)
      );
      let beginningSenderDaiBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let beginningRevenuePoolDaiBalance = await getBalance(
        daicpxdToken,
        revenuePool.address
      );
      let beginningMerchantFeeReceiverDaiBalance = await getBalance(
        daicpxdToken,
        merchantFeeReceiver
      );
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        merchantSafe,
        100
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        beginningMerchantSpendBalance.add(new BN("100"))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        beginningSenderDaiBalance.sub(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        beginningRevenuePoolDaiBalance.add(new BN(toWei("0.9")))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        merchantFeeReceiver,
        beginningMerchantFeeReceiverDaiBalance.add(new BN(toWei("0.1")))
      );
      expect(
        (
          await revenuePool.revenueBalance(merchantSafe, daicpxdToken.address)
        ).toString()
      ).to.equal(
        beginningMerchantDaiClaim.add(new BN(toWei("0.9"))).toString()
      );

      // reset state of the pool for the other tests
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
    });

    it("should reject if the recipient's address is not a registered merchant safe", async () => {
      let existingRecipientSPENDBalance = await spendToken.balanceOf(
        depot.address
      );
      let existingRecipientDaiBalance = await daicpxdToken.balanceOf(
        revenuePool.address
      );
      let existingDAISenderBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );

      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        depot.address, // the depot is not a merchant safe
        100
      ).should.be.rejectedWith(
        Error,
        // the real revert reason is behind the gnosis safe execTransaction
        // boundary, so we just get this generic error
        SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET
      );

      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        existingRecipientDaiBalance
      );
      await shouldBeSameBalance(
        spendToken,
        depot.address,
        existingRecipientSPENDBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAISenderBalance
      );
    });

    it("can pay a merchant when with a SPEND rate higher than the current USD rate but within the safety margin", async () => {
      let existingRecipientSPENDBalance = await spendToken.balanceOf(
        merchantSafe
      );
      let existingRecipientDaiBalance = await daicpxdToken.balanceOf(
        revenuePool.address
      );
      let existingDAISenderBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );

      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        merchantSafe,
        100,
        101000000 // +1%
      );

      let daiActualAmount = new BN("990099009900990099"); // ≈ 0.9901 DAI
      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        existingRecipientDaiBalance.add(daiActualAmount)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingRecipientSPENDBalance.add(new BN("100"))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAISenderBalance.sub(daiActualAmount)
      );
    });

    it("can pay a merchant when with a SPEND rate lower than the current USD rate but within the safety margin", async () => {
      let existingRecipientSPENDBalance = await spendToken.balanceOf(
        merchantSafe
      );
      let existingRecipientDaiBalance = await daicpxdToken.balanceOf(
        revenuePool.address
      );
      let existingDAISenderBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );

      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        merchantSafe,
        100,
        99000000 // -1%
      );

      let daiActualAmount = new BN("1010101010101010101"); // ≈ 1.0101 DAI
      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        existingRecipientDaiBalance.add(daiActualAmount)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingRecipientSPENDBalance.add(new BN("100"))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAISenderBalance.sub(daiActualAmount)
      );
    });

    it("reverts when SPEND rate is below safety margin", async () => {
      let existingRecipientSPENDBalance = await spendToken.balanceOf(
        merchantSafe
      );
      let existingRecipientDaiBalance = await daicpxdToken.balanceOf(
        revenuePool.address
      );
      let existingDAISenderBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );

      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        merchantSafe,
        100,
        98989000 // -1.1%
      ).should.be.rejectedWith(
        Error,
        "requested rate is beyond the allowable bounds"
      );

      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        existingRecipientDaiBalance
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingRecipientSPENDBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAISenderBalance
      );
    });

    it("reverts when SPEND rate is above safety margin", async () => {
      let existingRecipientSPENDBalance = await spendToken.balanceOf(
        merchantSafe
      );
      let existingRecipientDaiBalance = await daicpxdToken.balanceOf(
        revenuePool.address
      );
      let existingDAISenderBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );

      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        merchantSafe,
        100,
        101100000 // +1.1%
      ).should.be.rejectedWith(
        Error,
        "requested rate is beyond the allowable bounds"
      );

      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        existingRecipientDaiBalance
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingRecipientSPENDBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAISenderBalance
      );
    });

    it("reverts when tokens received do not equal the tokens expected given the requested SPEND rate", async () => {
      let existingRecipientSPENDBalance = await spendToken.balanceOf(
        merchantSafe
      );
      let existingRecipientDaiBalance = await daicpxdToken.balanceOf(
        revenuePool.address
      );
      let existingDAISenderBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );

      let spendAmount = 100;
      let requestedRate = 100000000; // 1 DAI = 1 USD
      let data = AbiCoder.encodeParameters(
        ["uint256", "uint256", "string", "bytes"],
        [
          spendAmount,
          requestedRate,
          "payMerchant",
          AbiCoder.encodeParameters(["address"], [merchantSafe]),
        ]
      );
      let payload = daicpxdToken.contract.methods
        .transferAndCall(
          revenuePool.address,
          // here we are maliciously manipulating the payload so that we are
          // transferring less DAI than what we promised via the requested rate
          // lock and specified spend amount
          toWei("0.5"), // the actual amount that we should be sending is 1 DAI
          data
        )
        .encodeABI();
      let signature = await signSafeTransaction(
        daicpxdToken.address,
        0,
        payload,
        0,
        0,
        0,
        0,
        daicpxdToken.address,
        ZERO_ADDRESS,
        await prepaidCard.nonce(),
        customer,
        prepaidCard
      );
      await prepaidCardManager
        .send(
          prepaidCard.address,
          spendAmount,
          requestedRate,
          0,
          0,
          0,
          "payMerchant",
          data,
          signature,
          { from: relayer }
        )
        .should.be.rejectedWith(
          Error,
          // The data that the prepaid card manager sends as part of the gnosis
          // safe exec tx (which it will derive the token amount to send based
          // on the specified spend amount and requested rate lock) will be
          // different than malicious data the EOA signed. This mismatch will
          // result in the gnosis safe ec-recover failing making gnosis think
          // that the owner of the safe is different than the signer. This is
          // totally a legit reason to fail, since it is indicative of signature
          // mismatch
          INVALID_OWNER_PROVIDED
        );

      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        existingRecipientDaiBalance
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingRecipientSPENDBalance
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAISenderBalance
      );
    });

    it("reverts when prepaid card calls with unknown action", async () => {
      let data = await prepaidCardManager.getSendData(
        prepaidCard.address,
        100,
        100000000, // 1 DAI = 1 USD
        "unknown action",
        AbiCoder.encodeParameters(["string"], ["do things"])
      );

      let signature = await signSafeTransaction(
        daicpxdToken.address,
        0,
        data,
        0,
        0,
        0,
        0,
        daicpxdToken.address,
        ZERO_ADDRESS,
        await prepaidCard.nonce(),
        customer,
        prepaidCard
      );

      return await prepaidCardManager
        .send(
          prepaidCard.address,
          100,
          100000000, // 1 DAI = 1 USD
          0,
          0,
          0,
          "unknown action",
          AbiCoder.encodeParameters(["string"], ["do things"]),
          signature,
          { from: relayer }
        )
        .should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET
        );
    });
  });

  describe("payments with exchange rate", () => {
    let prepaidCard;
    before(async () => {
      ({
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(100)]
      ));
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        customer,
        relayer
      );
    });
    afterEach(async () => {
      // reset the rate to 1:1
      await daiFeed.addRound(100000000, 1618435000, 1618435000);
    });

    it("when exchange rate is 2:1, a payment of 200 SPEND results in 1 DAI paid to the revenue pool", async () => {
      let existingSPENDBalance = await getBalance(spendToken, merchantSafe);
      let existingPrepaidCardDAIBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let existingRevenuePoolDAIBalance = await getBalance(
        daicpxdToken,
        revenuePool.address
      );
      await daiFeed.addRound(200000000, 1618435000, 1618435000);
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        merchantSafe,
        200,
        200000000
      );

      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingPrepaidCardDAIBalance.sub(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        existingRevenuePoolDAIBalance.add(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingSPENDBalance.add(toBN("200"))
      );
    });

    it("when exchange rate is 1:2, a payment of 50 SPEND results in 1 DAI paid to the revenue pool", async () => {
      let existingSPENDBalance = await getBalance(spendToken, merchantSafe);
      let existingDAIBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let existingRevenuePoolDAIBalance = await getBalance(
        daicpxdToken,
        revenuePool.address
      );
      await daiFeed.addRound(50000000, 1618436000, 1618436000);
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        merchantSafe,
        50,
        50000000
      );

      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAIBalance.sub(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        revenuePool.address,
        existingRevenuePoolDAIBalance.add(toTokenUnit(1))
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        existingSPENDBalance.add(toBN("50"))
      );
    });

    it("rejects when exchange rate is 0", async () => {
      let existingSPENDBalance = await spendToken.balanceOf(merchantSafe);
      let existingDAIBalance = await daicpxdToken.balanceOf(
        prepaidCard.address
      );
      await daiFeed.addRound(0, 1618436000, 1618436000);
      await payMerchant(
        prepaidCardManager,
        prepaidCard,
        relayer,
        customer,
        merchantSafe,
        100,
        0
      ).should.be.rejectedWith(Error, "exchange rate cannot be 0");

      await shouldBeSameBalance(spendToken, merchantSafe, existingSPENDBalance);
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        existingDAIBalance
      );
    });
  });

  describe("claim token", () => {
    it("can get the tokens for which the merchant has received revenue", async () => {
      let tokens = await revenuePool.revenueTokens(merchantSafe);
      expect(tokens).to.deep.equal([daicpxdToken.address]);
    });

    it("can get the merchants revenue balance for a payment token", async () => {
      let balance = await revenuePool.revenueBalance(
        merchantSafe,
        daicpxdToken.address
      );
      // The tests are stateful at this point the merchant has accumulated 7.900200020002000200 DAI
      // of customer payments
      expect(balance.toString()).to.equal("7900200020002000200");
    });

    it("allows a revenue claim issued from a merchant's safe (1 DAI CPXD)", async () => {
      let amount = toTokenUnit(1);
      let startingSPENDBalance = Number(
        BN(await getBalance(spendToken, merchantSafe)).toString()
      );
      let startingDAIBalance = fromWei(
        BN(await getBalance(daicpxdToken, merchantSafe)).toString()
      );
      let startingMerchantClaim = (
        await revenuePool.revenueBalance(merchantSafe, daicpxdToken.address)
      ).toString();

      let claimRevenue = revenuePool.contract.methods.claimRevenue(
        daicpxdToken.address,
        amount
      );
      let payload = claimRevenue.encodeABI();
      let gasEstimate = await claimRevenue.estimateGas({ from: merchantSafe });
      let safeTxData = {
        to: revenuePool.address,
        data: payload,
        txGasEstimate: gasEstimate,
        gasPrice: 1000000000,
        txGasToken: daicpxdToken.address,
        refundReceiver: relayer,
      };

      let merchantSafeContract = await GnosisSafe.at(merchantSafe);
      let {
        executionResult: { success, gasFee },
      } = await signAndSendSafeTransaction(
        safeTxData,
        merchant,
        merchantSafeContract,
        relayer
      );
      assert(success, "gnosis execution succesful");

      await shouldBeSameBalance(
        daicpxdToken,
        merchantSafe,
        toTokenUnit(startingDAIBalance + 1).sub(gasFee)
      );
      await shouldBeSameBalance(
        spendToken,
        merchantSafe,
        String(startingSPENDBalance)
      );
      expect(
        (
          await revenuePool.revenueBalance(merchantSafe, daicpxdToken.address)
        ).toString()
      ).to.equal(new BN(startingMerchantClaim).sub(toTokenUnit(1)).toString());
    });

    it("rejects a claim that is not issued from merchant's safe", async () => {
      let amount = toTokenUnit(1);
      await revenuePool
        .claimRevenue(daicpxdToken.address, amount, {
          from: merchant,
        })
        .should.be.rejectedWith(Error, "caller is not a merchant safe");
    });

    it("rejects a claim that is larger than the amount permissable for the merchant", async () => {
      let currentBalance = await revenuePool.revenueBalance(
        merchantSafe,
        daicpxdToken.address
      );
      let invalidAmount = currentBalance.add(new BN("100"));
      let claimRevenue = revenuePool.contract.methods.claimRevenue(
        daicpxdToken.address,
        invalidAmount
      );
      // reverts are trigged via the gas estimation, so we'll never get far
      // enough to actually issue the execTransaction on the safe
      await claimRevenue
        .estimateGas({ from: merchantSafe })
        .should.be.rejectedWith(Error, "Insufficient funds");
    });

    it("rejects a claim when merchant safe is disabled and allows after re-enabled", async () => {
      await merchantManager.disableSafe(merchantSafe);
      expect(await merchantManager.getDisabledMerchantSafes()).to.have.members([
        merchantSafe,
      ]);

      let amount = toTokenUnit(1);
      let claimRevenue = revenuePool.contract.methods.claimRevenue(
        daicpxdToken.address,
        amount
      );
      // reverts are trigged via the gas estimation, so we'll never get far
      // enough to actually issue the execTransaction on the safe
      await claimRevenue
        .estimateGas({ from: merchantSafe })
        .should.be.rejectedWith(Error, "merchant safe is disabled");

      //re-enabled merchant safe
      await merchantManager.enableSafe(merchantSafe);
      expect(await merchantManager.getDisabledMerchantSafes()).to.be.empty;
      await claimRevenue.estimateGas({ from: merchantSafe }).should.not
        .rejected;
    });
  });

  describe("handlers", () => {
    it("does not allow a non-handler to alter the merchant revenue balance", async () => {
      await revenuePool
        .addToMerchantBalance(
          merchantSafe,
          daicpxdToken.address,
          toTokenUnit(1),
          {
            from: merchant,
          }
        )
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
    });

    it("does not allow a non-handler to add a merchant", async () => {
      await merchantManager
        .registerMerchant(customer, "", { from: customer })
        .should.be.rejectedWith(Error, "caller is not registered");
    });
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await revenuePool.cardpayVersion()).to.equal("1.0.0");
      expect(await merchantManager.cardpayVersion()).to.equal("1.0.0");
      expect(await registerMerchantHandler.cardpayVersion()).to.equal("1.0.0");
    });
  });
});
