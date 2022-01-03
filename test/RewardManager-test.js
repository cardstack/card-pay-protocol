const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const SPEND = artifacts.require("SPEND.sol");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const RewardManager = artifacts.require("RewardManager");
const FakeRewardManager = artifacts.require("FakeRewardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const MerchantManager = artifacts.require("MerchantManager");
const ERC677Token = artifacts.require("ERC677Token.sol");
const RewardPool = artifacts.require("RewardPool");
const RewardSafeDelegateImplementation = artifacts.require(
  "RewardSafeDelegateImplementation"
);

const { randomHex } = require("web3-utils");
const { assert, expect, TOKEN_DETAIL_DATA } = require("./setup");

const {
  checkGnosisExecution,
  deployContract,
  getParamsFromEvent,
  ZERO_ADDRESS,
  rewardEIP1271Signature,
  gnosisErrors: {
    SIGNATURES_DATA_TOO_SHORT,
    INVALID_CONTRACT_SIGNATURE_PROVIDED,
    SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET,
    INVALID_OWNER_PROVIDED,
  },
} = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");

const {
  toTokenUnit,
  shouldBeSameBalance,
  getBalance,
  setupExchanges,
  addActionHandlers,
  registerRewardee,
  registerRewardProgram,
  lockRewardProgram,
  createDepotFromSupplierMgr,
  transferRewardSafe,
  swapOwner,
  swapOwnerWithFullSignature,
  addRewardRule,
  updateRewardProgramAdmin,
  createPrepaidCardAndTransfer,
  findAccountAfterAddress,
  findAccountBeforeAddress,
  setupVersionManager,
  withdrawFromRewardSafe,
  sendSafeTransaction,
  generateRewardProgramID,
} = require("./utils/helper");

const AbiCoder = require("web3-eth-abi");

const REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND = 500;
const DelegateCall = 1;

const encodeBlob = function (n = 100) {
  return randomHex(n);
};

contract("RewardManager", (accounts) => {
  //safe contracts
  let gnosisSafeMasterCopy, proxyFactory;

  //protocol contracts
  let prepaidCardManager,
    spendToken,
    actionDispatcher,
    revenuePool,
    merchantManager,
    versionManager,
    rewardPool,
    rewardSafeDelegate;
  // handlers
  let registerRewardeeHandler,
    registerRewardProgramHandler,
    lockRewardProgramHandler,
    addRewardRuleHandler,
    updateRewardProgramAdminHandler;

  // tokens and exchange
  let daicpxdToken, cardcpxdToken, fakeDaicpxdToken;
  let exchange;

  // reward manager
  let rewardManager;
  //roles
  let owner,
    // == cardpay
    issuer,
    prepaidCardOwner,
    merchantFeeReceiver,
    otherPrepaidCardOwner,
    prepaidCardOwnerA,
    prepaidCardOwnerB,
    // == services
    tally,
    relayer,
    // == reward program
    governanceAdmin,
    rewardProgramAdmin,
    rewardFeeReceiver;
  // safes
  let depot;
  // vars
  let rewardProgramID;

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    rewardProgramAdmin = accounts[2];
    prepaidCardOwner = accounts[3]; //original reward program admin
    relayer = accounts[4];
    merchantFeeReceiver = accounts[5];
    rewardFeeReceiver = accounts[6];
    otherPrepaidCardOwner = accounts[7];
    tally = accounts[8];
    governanceAdmin = accounts[9];

    // deploy
    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await deployContract(
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
    rewardManager = await RewardManager.new();

    let first10Accounts = accounts.slice(10);

    // Sometimes by chance the RM contract gets a really low or high address, I think it
    // depends on the current seed of the running test. If that happens, deploy a new
    // one until we get a middle enough address that one of our addresses is lexigraphically
    // before it and one after it at least
    //
    // This is pretty horrible but if we need to test differences in address ordering I think
    // it's necessary.
    while (
      // every account is after the RM address
      first10Accounts.every(
        (a) => a.toLowerCase() > rewardManager.address.toLowerCase()
      ) ||
      // every account is before the RM address
      first10Accounts.every(
        (a) => a.toLowerCase() < rewardManager.address.toLowerCase()
      )
    ) {
      rewardManager = await RewardManager.new();
    }

    await rewardManager.initialize(owner);
    rewardPool = await RewardPool.new();
    await rewardPool.initialize(owner);

    prepaidCardOwnerA = findAccountAfterAddress(
      first10Accounts,
      rewardManager.address
    );
    prepaidCardOwnerB = findAccountBeforeAddress(
      first10Accounts,
      rewardManager.address
    );
    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));

    // setup & configure
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
    await merchantManager.setup(
      actionDispatcher.address,
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
      [],
      versionManager.address
    );
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
    await rewardPool.setup(
      tally,
      rewardManager.address,
      tokenManager.address,
      versionManager.address
    );

    rewardSafeDelegate = await RewardSafeDelegateImplementation.new();

    await rewardManager.setup(
      actionDispatcher.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      rewardFeeReceiver,
      REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
      [rewardPool.address],
      governanceAdmin,
      rewardSafeDelegate.address,
      versionManager.address
    );

    await prepaidCardManager.addGasPolicy("transfer", false);
    await prepaidCardManager.addGasPolicy("split", true);
    await prepaidCardManager.addGasPolicy("registerRewardProgram", false);
    await prepaidCardManager.addGasPolicy("registerRewardee", true);
    await prepaidCardManager.addGasPolicy("lockRewardProgram", true);
    await prepaidCardManager.addGasPolicy("updateRewardProgramAdmin", true);
    await prepaidCardManager.addGasPolicy("addRewardRule", true);

    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address,
      versionManager.address
    );

    ({
      registerRewardeeHandler,
      registerRewardProgramHandler,
      lockRewardProgramHandler,
      addRewardRuleHandler,
      updateRewardProgramAdminHandler,
    } = await addActionHandlers({
      prepaidCardManager,
      revenuePool,
      actionDispatcher,
      merchantManager,
      tokenManager,
      rewardManager,
      owner,
      exchangeAddress: exchange.address,
      spendAddress: spendToken.address,
      versionManager,
    }));

    await daicpxdToken.mint(owner, toTokenUnit(100));

    depot = await createDepotFromSupplierMgr(supplierManager, issuer);
    await daicpxdToken.mint(depot.address, toTokenUnit(1000));

    fakeDaicpxdToken = await ERC677Token.new();
    await fakeDaicpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await fakeDaicpxdToken.mint(owner, toTokenUnit(1000));
  });

  describe("setup contract", () => {
    before(async () => {
      await rewardManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        rewardFeeReceiver,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        [rewardPool.address],
        governanceAdmin,
        rewardSafeDelegate.address,
        versionManager.address
      );
    });

    it("reverts when rewardFeeReceiver is set to zero address", async () => {
      await rewardManager
        .setup(
          actionDispatcher.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          ZERO_ADDRESS,
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
          [rewardPool.address],
          governanceAdmin,
          rewardSafeDelegate.address,
          versionManager.address
        )
        .should.be.rejectedWith(Error, "rewardFeeReceiver not set");
    });

    it("reverts when rewardProgramRegistrationFeeInSPEND is not set", async () => {
      await rewardManager
        .setup(
          actionDispatcher.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          rewardFeeReceiver,
          0,
          [rewardPool.address],
          governanceAdmin,
          rewardSafeDelegate.address,
          versionManager.address
        )
        .should.be.rejectedWith(
          Error,
          "rewardProgramRegistrationFeeInSPEND is not set"
        );
    });

    it("reverts when safeDelegateImplementation is set to zero address", async () => {
      await rewardManager
        .setup(
          actionDispatcher.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          rewardFeeReceiver,
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
          [rewardPool.address],
          governanceAdmin,
          ZERO_ADDRESS,
          versionManager.address
        )
        .should.be.rejectedWith(Error, "safeDelegateImplementation not set");
    });
    it("reverts when non-owner calls setup()", async () => {
      await rewardManager
        .setup(
          actionDispatcher.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          rewardFeeReceiver,
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
          [rewardPool.address],
          governanceAdmin,
          rewardSafeDelegate.address,
          versionManager.address,
          { from: issuer }
        )
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });
    it("check reward manager parameters", async () => {
      expect(await rewardManager.rewardFeeReceiver()).to.equal(
        rewardFeeReceiver
      );
      expect(await rewardManager.governanceAdmin()).to.equal(governanceAdmin);
      expect(
        (await rewardManager.rewardProgramRegistrationFeeInSPEND()).toString()
      ).to.equal("500");
      expect((await rewardManager.actionDispatcher()).toString()).to.equal(
        actionDispatcher.address
      );
      expect(await rewardManager.getEip1271Contracts()).to.deep.equal([
        rewardPool.address,
      ]);
    });
  });

  describe("register reward program", () => {
    let prepaidCard, otherPrepaidCard;
    beforeEach(async () => {
      rewardProgramID = generateRewardProgramID();
      prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5 + 1),
        prepaidCardOwner
      );
    });
    it("can register reward program", async () => {
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let startingRewardFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        rewardFeeReceiver
      );
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(5))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        rewardFeeReceiver,
        startingRewardFeeReceiverDaicpxdBalance.add(toTokenUnit(5))
      );
    });
    it("cannot register existing reward program", async () => {
      otherPrepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5 + 1),
        prepaidCardOwner
      );
      await registerRewardProgram(
        prepaidCardManager,
        otherPrepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      );
      await registerRewardProgram(
        prepaidCardManager,
        otherPrepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      ).should.be.rejectedWith(Error, SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET);
    });

    it("does not allow non-action handler to call registerRewardProgram", async () => {
      await rewardManager
        .registerRewardProgram(rewardProgramAdmin, rewardProgramID)
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
    });
    it("does not allow non-action handler to call transfer on registerRewardProgramHandler", async () => {
      await daicpxdToken
        .transferAndCall(
          registerRewardProgramHandler.address,
          toTokenUnit(5),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, // doesn't matter what this is
              AbiCoder.encodeParameters(
                ["address", "address"],
                [rewardProgramAdmin, rewardProgramID]
              ),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it("does not allow non-CPXD token to call registerRewardProgramHandler", async () => {
      await fakeDaicpxdToken
        .transferAndCall(
          registerRewardeeHandler.address,
          toTokenUnit(5),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, //doesn't matter what this is
              AbiCoder.encodeParameters(
                ["address", "address"],
                [rewardProgramAdmin, rewardProgramID]
              ),
            ]
          )
        )
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });

    it("reverts when prepaid card owner doesn't send enough spend from their prepaid for registration fee", async () => {
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND - 1,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      ).should.be.rejectedWith(Error, SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET);
    });
    it("refunds the prepaid card if the prepaid card owner pays more than the registration fee", async () => {
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let startingRewardFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        rewardFeeReceiver
      );
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND + 1,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      );
      await shouldBeSameBalance(
        daicpxdToken,
        prepaidCard.address,
        startingPrepaidCardDaicpxdBalance.sub(toTokenUnit(5))
      );
      await shouldBeSameBalance(
        daicpxdToken,
        rewardFeeReceiver,
        startingRewardFeeReceiverDaicpxdBalance.add(toTokenUnit(5))
      );
    });
  });

  describe("update/configure reward program", () => {
    let prepaidCard, otherPrepaidCard;
    beforeEach(async () => {
      rewardProgramID = generateRewardProgramID();
      prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5 + 1),
        prepaidCardOwner
      );
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        prepaidCardOwner,
        rewardProgramID
      );
    });
    it("can remove existing reward program by governance admin", async () => {
      await rewardManager.removeRewardProgram(rewardProgramID, {
        from: governanceAdmin,
      });
      expect(await rewardManager.isRewardProgram(rewardProgramID)).to.equal(
        false
      );
      expect(
        await rewardManager.rewardProgramAdmins.call(rewardProgramID)
      ).to.equal(ZERO_ADDRESS);
      expect(
        await rewardManager.rewardProgramLocked.call(rewardProgramID)
      ).to.equal(false);
    });
    it("cannot remove existing reward program if not governance admin", async () => {
      await rewardManager
        .removeRewardProgram(rewardProgramID, { from: rewardProgramAdmin })
        .should.be.rejectedWith("caller is not governance admin");
      await rewardManager
        .removeRewardProgram(rewardProgramID, { from: owner })
        .should.be.rejectedWith("caller is not governance admin");
    });
    it("cannot add reward rule if reward program removed", async () => {
      const blob = encodeBlob();
      await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        blob
      );
      expect(await rewardManager.rule(rewardProgramID)).to.equal(blob);
      await rewardManager.removeRewardProgram(rewardProgramID, {
        from: governanceAdmin,
      });
      await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        encodeBlob()
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
      expect(await rewardManager.rule(rewardProgramID)).to.equal(null);
    });
    it("cannot update admin if reward program removed", async () => {
      expect(await rewardManager.rewardProgramAdmins(rewardProgramID)).to.equal(
        prepaidCardOwner
      );
      await rewardManager.removeRewardProgram(rewardProgramID, {
        from: governanceAdmin,
      });
      await updateRewardProgramAdmin(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        rewardProgramAdmin
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
      expect(await rewardManager.rewardProgramAdmins(rewardProgramID)).to.equal(
        ZERO_ADDRESS
      );
    });
    it("cannot register rewardee if reward program removed", async () => {
      await rewardManager.removeRewardProgram(rewardProgramID, {
        from: governanceAdmin,
      });
      await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
    });
    it("cannot lock reward program if reward program removed", async () => {
      await lockRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID
      );
      expect(
        await rewardManager.rewardProgramLocked.call(rewardProgramID)
      ).to.equal(true);
      await rewardManager.removeRewardProgram(rewardProgramID, {
        from: governanceAdmin,
      });
      await lockRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
      expect(
        await rewardManager.rewardProgramLocked.call(rewardProgramID)
      ).to.equal(false);
    });
    it("can transfer reward safe if reward program removed", async () => {
      let tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      let rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      let rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
      await rewardManager.removeRewardProgram(rewardProgramID, {
        from: governanceAdmin,
      });
      await transferRewardSafe({
        rewardManager: rewardManager,
        rewardSafe: rewardSafe,
        oldOwner: prepaidCardOwner,
        newOwner: otherPrepaidCardOwner,
        relayer: relayer,
        gasToken: daicpxdToken,
      });
      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
    });
    it("can add rule in reward program", async () => {
      const prepaidCardPreviousBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let blob = encodeBlob();
      expect(await rewardManager.rule(rewardProgramID)).to.equal(null);
      const txn = await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        blob
      );
      const { gasFee, success } = checkGnosisExecution(
        txn,
        prepaidCard.address
      );
      const prepaidCardBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      assert(success, "gnosis execution succesfull");
      assert(
        prepaidCardPreviousBalanceDai.sub(gasFee).eq(prepaidCardBalanceDai),
        "the prepaid card token balance is correct"
      );
      expect(await rewardManager.rule(rewardProgramID)).to.equal(blob);
    });

    it("can update rule once it has been set in reward program", async () => {
      const prepaidCardPreviousBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let blob = encodeBlob();
      expect(await rewardManager.rule(rewardProgramID)).to.equal(null);
      const txn = await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        blob
      );
      const { gasFee, success } = checkGnosisExecution(
        txn,
        prepaidCard.address
      );
      const prepaidCardBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      assert(success, "gnosis execution succesfull");
      assert(
        prepaidCardPreviousBalanceDai.sub(gasFee).eq(prepaidCardBalanceDai),
        "the prepaid card token balance is correct"
      );
      expect(await rewardManager.rule(rewardProgramID)).to.equal(blob);
      const newBlob = encodeBlob();
      await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        newBlob
      );
      expect(await rewardManager.rule(rewardProgramID)).to.equal(newBlob);
    });
    it("cannot add rule reward program if not admin", async () => {
      otherPrepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5 + 1),
        otherPrepaidCardOwner
      );
      await addRewardRule(
        prepaidCardManager,
        otherPrepaidCard,
        relayer,
        otherPrepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        encodeBlob()
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
    });
    it("does not allow non-action handler to call addRewardRule", async () => {
      await rewardManager
        .addRewardRule(rewardProgramID, encodeBlob())
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
    });
    it("does not allow non-action handler to call transfer on addRewardRule", async () => {
      await daicpxdToken
        .transferAndCall(
          addRewardRuleHandler.address,
          toTokenUnit(0),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, // doesn't matter what this is
              AbiCoder.encodeParameters(
                ["address", "bytes"],
                [rewardProgramID, encodeBlob()]
              ),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it("does not allow non-CPXD token to call addRewardRule", async () => {
      await fakeDaicpxdToken
        .transferAndCall(
          addRewardRuleHandler.address,
          toTokenUnit(0),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, //doesn't matter what this is
              AbiCoder.encodeParameters(
                ["address", "bytes"],
                [rewardProgramID, encodeBlob()]
              ),
            ]
          )
        )
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });
    it("can lock reward program", async () => {
      const prepaidCardPreviousBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      expect(
        await rewardManager.rewardProgramLocked.call(rewardProgramID)
      ).to.equal(false);
      let txn = await lockRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID
      );
      const { gasFee, success } = checkGnosisExecution(
        txn,
        prepaidCard.address
      );
      const prepaidCardBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      assert(success, "gnosis execution succesfull");
      assert(
        prepaidCardPreviousBalanceDai.sub(gasFee).eq(prepaidCardBalanceDai),
        "the prepaid card token balance is correct"
      );
      expect(
        await rewardManager.rewardProgramLocked.call(rewardProgramID)
      ).to.equal(true);
    });
    it("can unlock reward program", async () => {
      expect(
        await rewardManager.rewardProgramLocked.call(rewardProgramID)
      ).to.equal(false);
      await lockRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID
      );
      expect(
        await rewardManager.rewardProgramLocked.call(rewardProgramID)
      ).to.equal(true);
      await lockRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID
      );
      expect(
        await rewardManager.rewardProgramLocked.call(rewardProgramID)
      ).to.equal(false);
    });
    it("cannot lock reward program if not admin", async () => {
      otherPrepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5 + 1),
        otherPrepaidCardOwner
      );
      expect(
        await rewardManager.rewardProgramLocked.call(rewardProgramID)
      ).to.equal(false);
      await lockRewardProgram(
        prepaidCardManager,
        otherPrepaidCard,
        relayer,
        otherPrepaidCardOwner,
        0,
        undefined,
        rewardProgramID
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
    });

    it("does not allow non-action handler to call lockRewardProgram", async () => {
      await rewardManager
        .lockRewardProgram(rewardProgramID)
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
    });
    it("does not allow non-action handler to call transfer on lockRewardProgram", async () => {
      await daicpxdToken
        .transferAndCall(
          lockRewardProgramHandler.address,
          toTokenUnit(0),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, // doesn't matter what this is
              AbiCoder.encodeParameters(["address"], [rewardProgramID]),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it("does not allow non-CPXD token to call lockRewardProgram", async () => {
      await fakeDaicpxdToken
        .transferAndCall(
          lockRewardProgramHandler.address,
          toTokenUnit(0),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, //doesn't matter what this is
              AbiCoder.encodeParameters(["address"], [rewardProgramID]),
            ]
          )
        )
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });
    it("can update rewardProgramAdmin of reward program", async () => {
      const prepaidCardPreviousBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      expect(
        await rewardManager.rewardProgramAdmins.call(rewardProgramID)
      ).to.equal(prepaidCardOwner);
      const txn = await updateRewardProgramAdmin(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        rewardProgramAdmin
      );
      const { gasFee, success } = checkGnosisExecution(
        txn,
        prepaidCard.address
      );
      const prepaidCardBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      assert(success, "gnosis execution succesfull");
      assert(
        prepaidCardPreviousBalanceDai.sub(gasFee).eq(prepaidCardBalanceDai),
        "the prepaid card token balance is correct"
      );
      expect(
        await rewardManager.rewardProgramAdmins.call(rewardProgramID)
      ).to.equal(rewardProgramAdmin);
    });
    it("cannot update reward program admin if not admin", async () => {
      otherPrepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5 + 1),
        otherPrepaidCardOwner
      );

      await updateRewardProgramAdmin(
        prepaidCardManager,
        otherPrepaidCard,
        relayer,
        otherPrepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        rewardProgramAdmin
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
    });
    it("does not allow non-action handler to call updateRewardProgramAdmin", async () => {
      await rewardManager
        .updateAdmin(rewardProgramID, rewardProgramAdmin)
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
    });
    it("does not allow non-action handler to call transfer on updateRewardProgramAdmin", async () => {
      await daicpxdToken
        .transferAndCall(
          updateRewardProgramAdminHandler.address,
          toTokenUnit(0),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, // doesn't matter what this is
              AbiCoder.encodeParameters(
                ["address", "address"],
                [rewardProgramID, rewardProgramAdmin]
              ),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it("does not allow non-CPXD token to call updateRewardProgramAdmin", async () => {
      await fakeDaicpxdToken
        .transferAndCall(
          updateRewardProgramAdminHandler.address,
          toTokenUnit(0),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, //doesn't matter what this is
              AbiCoder.encodeParameters(
                ["address", "address"],
                [rewardProgramID, rewardProgramAdmin]
              ),
            ]
          )
        )
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });
  });

  describe("rewardee registers for reward program", () => {
    let prepaidCard, otherPrepaidCard;
    beforeEach(async () => {
      rewardProgramID = generateRewardProgramID();
      prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(10 + 1),
        prepaidCardOwner
      );
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      );
    });
    it("register rewardee for reward program", async () => {
      let previousPrepaidCardBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      const txn = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      const { gasFee, success } = await checkGnosisExecution(
        txn,
        prepaidCard.address
      );
      const prepaidCardBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      assert(success, "gnosis execution succesfull");
      assert(
        previousPrepaidCardBalanceDai.sub(gasFee).eq(prepaidCardBalanceDai),
        "the prepaid card token balance is correct"
      );
    });

    it("does not allow non-action handler to call registerRewardee", async () => {
      await rewardManager
        .registerRewardee(rewardProgramID, prepaidCardOwner)
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
    });
    it("does not allow non-action handler to call transfer on PrepaidCardManager", async () => {
      await daicpxdToken
        .transferAndCall(
          registerRewardeeHandler.address,
          toTokenUnit(5),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, // doesn't matter what this is
              AbiCoder.encodeParameters(["address"], [rewardProgramID]),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it("does not allow non-CPXD token to call registerRewardeeHandler", async () => {
      await fakeDaicpxdToken
        .transferAndCall(
          registerRewardeeHandler.address,
          toTokenUnit(5),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, //doesn't matter what this is
              AbiCoder.encodeParameters(["address"], [rewardProgramID]),
            ]
          )
        )
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });
    it("reverts when rewardee already has a safe for the reward program", async () => {
      await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      otherPrepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5 + 1),
        prepaidCardOwner
      );
      await registerRewardee(
        prepaidCardManager,
        otherPrepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
    });
  });

  describe("transfer reward safe", () => {
    let prepaidCard, rewardSafe;

    beforeEach(async () => {
      rewardProgramID = generateRewardProgramID();
      prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(10 + 1),
        prepaidCardOwner
      );
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      );
    });

    it("can transfer reward safe", async () => {
      let tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      let rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      let rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwner);

      expect(
        await rewardManager.ownedRewardSafes(prepaidCardOwner, rewardProgramID)
      ).to.equal(rewardSafe.address);

      let { safeTx } = await transferRewardSafe({
        rewardManager,
        rewardSafe,
        oldOwner: prepaidCardOwner,
        newOwner: otherPrepaidCardOwner,
        relayer,
        gasToken: daicpxdToken,
      });

      let params = await getParamsFromEvent(
        safeTx,
        eventABIs.REWARD_SAFE_TRANSFER,
        rewardSafe.address
      );

      expect(params.length).to.equal(1);
      expect(params[0]).to.deep.include({
        rewardSafe: rewardSafe.address,
        oldOwner: prepaidCardOwner,
        newOwner: otherPrepaidCardOwner,
      });

      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);

      expect(
        await rewardManager.ownedRewardSafes(prepaidCardOwner, rewardProgramID)
      ).to.equal(ZERO_ADDRESS);
      expect(
        await rewardManager.ownedRewardSafes(
          otherPrepaidCardOwner,
          rewardProgramID
        )
      ).to.equal(rewardSafe.address);
    });

    it("cannot transfer reward safe to an owner who already owns a reward safe", async () => {
      let otherPrepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(10 + 1),
        otherPrepaidCardOwner
      );
      let tx1 = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      let rewardSafeCreation1 = await getParamsFromEvent(
        tx1,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      let rewardSafe1 = await GnosisSafe.at(rewardSafeCreation1[0].rewardSafe);

      expect(
        await rewardManager.ownedRewardSafes(prepaidCardOwner, rewardProgramID)
      ).to.equal(rewardSafe1.address);

      let tx2 = await registerRewardee(
        prepaidCardManager,
        otherPrepaidCard,
        relayer,
        otherPrepaidCardOwner,
        undefined,
        rewardProgramID
      );
      let rewardSafeCreation2 = await getParamsFromEvent(
        tx2,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      let rewardSafe2 = await GnosisSafe.at(rewardSafeCreation2[0].rewardSafe);

      expect(
        await rewardManager.ownedRewardSafes(
          otherPrepaidCardOwner,
          rewardProgramID
        )
      ).to.equal(rewardSafe2.address);

      await expect(
        transferRewardSafe({
          rewardManager,
          rewardSafe: rewardSafe2,
          oldOwner: otherPrepaidCardOwner,
          newOwner: prepaidCardOwner,
          relayer,
          gasToken: daicpxdToken,
        })
      ).to.be.rejectedWith(SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET);
    });

    it("cannot transfer reward safe with swap owner with EOA-signature only", async () => {
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      const rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      let rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwner);
      await swapOwner(
        rewardManager,
        rewardSafe,
        prepaidCardOwner,
        otherPrepaidCardOwner,
        relayer,
        daicpxdToken
      ).should.be.rejectedWith(Error, SIGNATURES_DATA_TOO_SHORT);
    });

    it("cannot transfer reward safe with swap owner full signature", async () => {
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      const rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      let rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwner);
      await swapOwnerWithFullSignature(
        rewardManager,
        rewardSafe,
        prepaidCardOwner,
        otherPrepaidCardOwner,
        relayer,
        daicpxdToken
      ).should.be.rejectedWith(Error, INVALID_CONTRACT_SIGNATURE_PROVIDED);
    });
    it("new owner can transfer reward safe after it has been transferred to them", async () => {
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      const rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwner);
      await transferRewardSafe({
        rewardManager: rewardManager,
        rewardSafe: rewardSafe,
        oldOwner: prepaidCardOwner,
        newOwner: otherPrepaidCardOwner,
        relayer: relayer,
        gasToken: daicpxdToken,
      });
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
      await transferRewardSafe({
        rewardManager: rewardManager,
        rewardSafe: rewardSafe,
        oldOwner: otherPrepaidCardOwner,
        newOwner: prepaidCardOwnerA,
        relayer: relayer,
        gasToken: daicpxdToken,
      });
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwnerA);
    });
    it("old owner cannot transfer reward safe after it has been transferred from them", async () => {
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      const rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwner);
      await transferRewardSafe({
        rewardManager: rewardManager,
        rewardSafe: rewardSafe,
        oldOwner: prepaidCardOwner,
        newOwner: otherPrepaidCardOwner,
        relayer: relayer,
        gasToken: daicpxdToken,
      });
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
      await transferRewardSafe({
        rewardManager: rewardManager,
        rewardSafe: rewardSafe,
        oldOwner: prepaidCardOwner,
        newOwner: prepaidCardOwnerA,
        relayer: relayer,
        gasToken: daicpxdToken,
      }).should.be.rejectedWith(Error, INVALID_OWNER_PROVIDED);
    });
    it("can sign with address lexigraphically after reward manager contract address for transfer", async () => {
      prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(10 + 1),
        prepaidCardOwnerA
      );
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwnerA,
        undefined,
        rewardProgramID
      );
      const rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwnerA);
      await transferRewardSafe({
        rewardManager: rewardManager,
        rewardSafe: rewardSafe,
        oldOwner: prepaidCardOwnerA,
        newOwner: otherPrepaidCardOwner,
        relayer: relayer,
        gasToken: daicpxdToken,
      });
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
    });
    it("can sign with address lexigraphically before reward manager contract address for transfer", async () => {
      prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(10 + 1),
        prepaidCardOwnerB
      );
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwnerB,
        undefined,
        rewardProgramID
      );
      const rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwnerB);
      await transferRewardSafe({
        rewardManager: rewardManager,
        rewardSafe: rewardSafe,
        oldOwner: prepaidCardOwnerB,
        newOwner: otherPrepaidCardOwner,
        relayer: relayer,
        gasToken: daicpxdToken,
      });
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
    });
    it("can issue a new reward safe to a rewardee after they transferred their old reward safe", async () => {
      let tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      let rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      let rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwner);
      await transferRewardSafe({
        rewardManager: rewardManager,
        rewardSafe: rewardSafe,
        oldOwner: prepaidCardOwner,
        newOwner: otherPrepaidCardOwner,
        relayer: relayer,
        gasToken: daicpxdToken,
      });
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);

      let tx2 = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );
      let rewardSafeCreation2 = await getParamsFromEvent(
        tx2,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      let rewardSafe2 = await GnosisSafe.at(rewardSafeCreation2[0].rewardSafe);
      let owners2 = await rewardSafe2.getOwners();

      expect(owners2.length).to.equal(2);
      expect(owners2[1]).to.equal(prepaidCardOwner);

      expect(rewardSafe2.address).to.not.equal(rewardSafe.address);
    });
  });

  describe("withdraw from reward safe", () => {
    let prepaidCard, rewardSafe;

    beforeEach(async () => {
      rewardProgramID = generateRewardProgramID();
      prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(10 + 1),
        prepaidCardOwner
      );
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      );
      let tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        undefined,
        rewardProgramID
      );

      let rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARDEE_REGISTERED,
        rewardManager.address
      );
      rewardSafe = await GnosisSafe.at(rewardSafeCreation[0].rewardSafe);

      await daicpxdToken.mint(rewardSafe.address, toTokenUnit(100));

      let owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(prepaidCardOwner);
    });

    it("can withdraw from reward safe", async () => {
      expect(
        await daicpxdToken.balanceOf(rewardSafe.address)
      ).to.be.bignumber.equal(toTokenUnit(100));
      expect(
        await daicpxdToken.balanceOf(prepaidCardOwner)
      ).to.be.bignumber.equal(toTokenUnit(0));

      let { safeTx } = await withdrawFromRewardSafe({
        rewardManager: rewardManager,
        rewardSafe: rewardSafe,
        tokenAddress: daicpxdToken.address,
        to: prepaidCardOwner,
        value: toTokenUnit(50),
        relayer: relayer,
        gasToken: daicpxdToken,
      });

      let params = await getParamsFromEvent(
        safeTx,
        eventABIs.REWARD_SAFE_WITHDRAWAL,
        rewardSafe.address
      );

      expect(params.length).to.equal(1);
      expect(params[0]).to.deep.include({
        rewardSafe: rewardSafe.address,
        token: daicpxdToken.address,
        value: toTokenUnit(50).toString(),
      });

      expect(
        await daicpxdToken.balanceOf(rewardSafe.address)
      ).to.be.bignumber.equal(toTokenUnit(50));

      expect(
        await daicpxdToken.balanceOf(prepaidCardOwner)
      ).to.be.bignumber.equal(toTokenUnit(50));
    });

    it("cannot withdraw invalid token", async function () {
      await fakeDaicpxdToken.mint(rewardSafe.address, toTokenUnit(100));
      expect(
        await fakeDaicpxdToken.balanceOf(rewardSafe.address)
      ).to.be.bignumber.equal(toTokenUnit(100));

      await expect(
        withdrawFromRewardSafe({
          rewardManager: rewardManager,
          rewardSafe: rewardSafe,
          tokenAddress: fakeDaicpxdToken.address,
          to: prepaidCardOwner,
          value: toTokenUnit(50),
          relayer: relayer,
          gasToken: daicpxdToken,
        })
      ).to.be.rejectedWith(SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET);
      expect(
        await fakeDaicpxdToken.balanceOf(rewardSafe.address)
      ).to.be.bignumber.equal(toTokenUnit(100));
    });

    it("can withdraw to different address other than the reward safe owner", async function () {
      expect(
        (
          await withdrawFromRewardSafe({
            rewardManager: rewardManager,
            rewardSafe: rewardSafe,
            tokenAddress: daicpxdToken.address,
            to: otherPrepaidCardOwner,
            value: toTokenUnit(50),
            relayer: relayer,
            gasToken: daicpxdToken,
          })
        ).executionResult.success
      ).to.equal(true);
      expect(
        await daicpxdToken.balanceOf(rewardSafe.address)
      ).to.be.bignumber.equal(toTokenUnit(50));
      expect(
        await daicpxdToken.balanceOf(otherPrepaidCardOwner)
      ).to.be.bignumber.equal(toTokenUnit(50));
    });

    it("cannot withdraw with a fake reward manager; validates reward manager address on reward safe delegate implementation", async function () {
      const rewardSafeEOA = (await rewardSafe.getOwners())[1];

      let delegateImplementation = await RewardSafeDelegateImplementation.at(
        await rewardManager.safeDelegateImplementation()
      );

      let fakeRewardManager = await FakeRewardManager.new();

      let payload = delegateImplementation.contract.methods.withdraw(
        fakeRewardManager.address,
        daicpxdToken.address,
        prepaidCardOwner,
        toTokenUnit(50)
      );
      let data = payload.encodeABI();

      const fullSignature = await rewardEIP1271Signature({
        // When using DelegateCall, the "to" argument is misleading.
        // The transaction is actually sent to the safe address, but using the contract
        // implementation at the adderess passed in the "to" field
        to: delegateImplementation.address,
        value: 0,
        data,
        operation: DelegateCall,
        txGasEstimate: 0,
        baseGasEstimate: 0,
        gasPrice: 0,
        txGasToken: daicpxdToken.address,
        refundReceiver: rewardSafe.address,
        nonce: await rewardSafe.nonce(),
        owner: rewardSafeEOA,
        gnosisSafe: rewardSafe,
        verifyingContract: rewardManager,
      });

      let safeTxData = {
        to: delegateImplementation.address,
        data,
        operation: DelegateCall,
        txGasEstimate: 0,
        gasPrice: 0,
        txGasToken: daicpxdToken.address,
        refundReceiver: rewardSafe.address,
      };

      await sendSafeTransaction(
        safeTxData,
        rewardSafe,
        relayer,
        fullSignature
      ).should.be.rejectedWith("invalid manager");
    });
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await rewardManager.cardpayVersion()).to.equal("1.0.0");
      expect(await registerRewardeeHandler.cardpayVersion()).to.equal("1.0.0");
      expect(await registerRewardProgramHandler.cardpayVersion()).to.equal(
        "1.0.0"
      );
      expect(await lockRewardProgramHandler.cardpayVersion()).to.equal("1.0.0");
      expect(await addRewardRuleHandler.cardpayVersion()).to.equal("1.0.0");
      expect(await updateRewardProgramAdminHandler.cardpayVersion()).to.equal(
        "1.0.0"
      );
    });
  });
});
