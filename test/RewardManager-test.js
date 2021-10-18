const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const SPEND = artifacts.require("SPEND.sol");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const RewardManager = artifacts.require("RewardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const MerchantManager = artifacts.require("MerchantManager");
const ERC677Token = artifacts.require("ERC677Token.sol");
const RewardPool = artifacts.require("RewardPool");

const { randomHex } = require("web3-utils");
const { assert, expect, TOKEN_DETAIL_DATA } = require("./setup");
const utils = require("./utils/general");
const { ZERO_ADDRESS } = utils;
const { getParamsFromEvent, checkGnosisExecution } = require("./utils/general");
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
  removeRewardRule,
  updateRewardProgramAdmin,
  createPrepaidCardAndTransfer,
  findAccountAfterAddress,
  findAccountBeforeAddress,
} = require("./utils/helper");

const AbiCoder = require("web3-eth-abi");

const REWARDEE_REGISTRATION_FEE_IN_SPEND = 500;
const REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND = 500;
const tallyRuleDID = "did:cardstack:1tdnHDwr8Z4Z7sHGceo2kArC9a5a297f45ef5491";
const benefitDID = "did:cardstack:1b1kyKHhwKF5BT3w4p8w5AGc12ada71be496beea";
const ruleDID = "did:cardstack:1r4r2PZpazPtbcKU3yR6BTUwf1c425ad7fd6f9ee";

contract("RewardManager", (accounts) => {
  //main contracts
  let gnosisSafeMasterCopy,
    proxyFactory,
    prepaidCardManager,
    spendToken,
    actionDispatcher,
    revenuePool,
    merchantManager,
    rewardPool;
  // handlers
  let registerRewardeeHandler,
    registerRewardProgramHandler,
    lockRewardProgramHandler,
    addRewardRuleHandler,
    removeRewardRuleHandler,
    updateRewardProgramAdminHandler;

  // tokens
  let daicpxdToken, cardcpxdToken, fakeDaicpxdToken;
  let exchange;

  // reward manager contract
  let rewardManager;
  //roles
  let owner,
    issuer,
    prepaidCardOwner,
    relayer,
    merchantFeeReceiver,
    otherPrepaidCardOwner,
    tally,
    prepaidCardOwnerA,
    prepaidCardOwnerB;
  // safes
  let depot;
  // reward roles
  let rewardProgramID, rewardProgramAdmin, rewardFeeReceiver;

  before(async () => {
    // accounts
    owner = accounts[0];
    issuer = accounts[1];
    rewardProgramAdmin = accounts[2];
    prepaidCardOwner = accounts[3]; //original reward program admin
    relayer = accounts[4];
    merchantFeeReceiver = accounts[5];
    rewardFeeReceiver = accounts[6];
    otherPrepaidCardOwner = accounts[7];
    tally = accounts[8];

    // deploy
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
    rewardManager = await RewardManager.new();
    await rewardManager.initialize(owner);
    rewardPool = await RewardPool.new();
    await rewardPool.initialize(owner);

    prepaidCardOwnerA = findAccountAfterAddress(
      accounts.slice(10),
      rewardManager.address
    );
    prepaidCardOwnerB = findAccountBeforeAddress(
      accounts.slice(10),
      rewardManager.address
    );
    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));

    // setup
    await tokenManager.setup(ZERO_ADDRESS, [
      daicpxdToken.address,
      cardcpxdToken.address,
    ]);
    await supplierManager.setup(
      ZERO_ADDRESS,
      gnosisSafeMasterCopy.address,
      proxyFactory.address
    );
    await merchantManager.setup(
      actionDispatcher.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      ZERO_ADDRESS
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
      []
    );
    await revenuePool.setup(
      exchange.address,
      merchantManager.address,
      actionDispatcher.address,
      prepaidCardManager.address,
      merchantFeeReceiver,
      0,
      1000
    );
    await rewardPool.setup(tally, rewardManager.address, tokenManager.address);
    await rewardManager.setup(
      actionDispatcher.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      rewardFeeReceiver,
      REWARDEE_REGISTRATION_FEE_IN_SPEND,
      REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
      [rewardPool.address]
    );

    await prepaidCardManager.addGasPolicy("transfer", false);
    await prepaidCardManager.addGasPolicy("split", true);
    await prepaidCardManager.addGasPolicy("registerRewardProgram", false);
    await prepaidCardManager.addGasPolicy("registerRewardee", false);
    await prepaidCardManager.addGasPolicy("lockRewardProgram", true);
    await prepaidCardManager.addGasPolicy("updateRewardProgramAdmin", true);
    await prepaidCardManager.addGasPolicy("addRewardRule", true);
    await prepaidCardManager.addGasPolicy("removeRewardRule", true);

    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address
    );

    ({
      registerRewardeeHandler,
      registerRewardProgramHandler,
      lockRewardProgramHandler,
      addRewardRuleHandler,
      removeRewardRuleHandler,
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
    }));

    await daicpxdToken.mint(owner, toTokenUnit(100));

    //safes
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
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        [rewardPool.address]
      );
    });

    it("reverts when rewardFeeReceiver is set to zero address", async () => {
      await rewardManager
        .setup(
          actionDispatcher.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          ZERO_ADDRESS,
          REWARDEE_REGISTRATION_FEE_IN_SPEND,
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
          [rewardPool.address]
        )
        .should.be.rejectedWith(Error, "rewardFeeReceiver not set");
    });
    it("reverts when rewardeeRegistrationFeeInSPEND is not set", async () => {
      await rewardManager
        .setup(
          actionDispatcher.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          rewardFeeReceiver,
          0,
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
          [rewardPool.address]
        )
        .should.be.rejectedWith(
          Error,
          "rewardeeRegistrationFeeInSPEND is not set"
        );
    });

    it("reverts when rewardProgramRegistrationFeeInSPEND is not set", async () => {
      await rewardManager
        .setup(
          actionDispatcher.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          rewardFeeReceiver,
          REWARDEE_REGISTRATION_FEE_IN_SPEND,
          0,
          [rewardPool.address]
        )
        .should.be.rejectedWith(
          Error,
          "rewardProgramRegistrationFeeInSPEND is not set"
        );
    });
    it("reverts when non-owner calls setup()", async () => {
      await rewardManager
        .setup(
          actionDispatcher.address,
          gnosisSafeMasterCopy.address,
          proxyFactory.address,
          rewardFeeReceiver,
          REWARDEE_REGISTRATION_FEE_IN_SPEND,
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
          [rewardPool.address],
          { from: issuer }
        )
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });
    it("check reward manager parameters", async () => {
      expect(await rewardManager.rewardFeeReceiver()).to.equal(
        rewardFeeReceiver
      );
      expect(
        (await rewardManager.rewardeeRegistrationFeeInSPEND()).toString()
      ).to.equal("500");
      expect(
        (await rewardManager.rewardProgramRegistrationFeeInSPEND()).toString()
      ).to.equal("500");
      expect((await rewardManager.actionDispatcher()).toString()).to.equal(
        actionDispatcher.address
      );
    });
  });

  describe("create reward program", () => {
    let prepaidCard, otherPrepaidCard;
    beforeEach(async () => {
      rewardProgramID = randomHex(20);
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
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
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

    it("reverts when prepaid card owner doesn't send enough in their prepaid card for the reward program registration fee amount", async () => {
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND - 1,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
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

  describe("update reward program", () => {
    let prepaidCard, otherPrepaidCard;
    beforeEach(async () => {
      rewardProgramID = randomHex(20);
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
        prepaidCardOwner, //current rewardProgramAdmin
        rewardProgramID
      );
    });
    it("can remove existing reward program", async () => {
      await rewardManager.removeRewardProgram(rewardProgramID, {
        from: owner,
      });
      expect(await rewardManager.isRewardProgram(rewardProgramID)).to.equal(
        false
      );
      expect(
        await rewardManager.rewardProgramAdmins.call(rewardProgramID)
      ).to.equal(ZERO_ADDRESS);
    });
    it("cannot remove existing reward program if not owner", async () => {
      await rewardManager
        .removeRewardProgram(rewardProgramID, { from: rewardProgramAdmin })
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });
    it("can add rule in reward program", async () => {
      const prepaidCardPreviousBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      expect(await rewardManager.hasRule(rewardProgramID, ruleDID)).to.equal(
        false
      );
      const txn = await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        ruleDID,
        tallyRuleDID,
        benefitDID
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
      expect(await rewardManager.hasRule(rewardProgramID, ruleDID)).to.equal(
        true
      );
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
        ruleDID,
        tallyRuleDID,
        benefitDID
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
    });
    it("does not allow non-action handler to call addRewardRule", async () => {
      await rewardManager
        .addRewardRule(rewardProgramID, ruleDID, tallyRuleDID, benefitDID)
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
                ["address", "string", "string", "string"],
                [rewardProgramID, ruleDID, tallyRuleDID, benefitDID]
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
                ["address", "string", "string", "string"],
                [rewardProgramID, ruleDID, tallyRuleDID, benefitDID]
              ),
            ]
          )
        )
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });
    it("can remove reward rule", async () => {
      await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        ruleDID,
        tallyRuleDID,
        benefitDID
      );
      const prepaidCardPreviousBalanceDai = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      expect(await rewardManager.hasRule(rewardProgramID, ruleDID)).to.equal(
        true
      );
      const txn = await removeRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        ruleDID
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
      expect(await rewardManager.hasRule(rewardProgramID, ruleDID)).to.equal(
        false
      );
    });
    it("cannot remove reward rule if not admin", async () => {
      await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        ruleDID,
        tallyRuleDID,
        benefitDID
      );
      otherPrepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(5 + 1),
        otherPrepaidCardOwner
      );
      await removeRewardRule(
        prepaidCardManager,
        otherPrepaidCard,
        relayer,
        otherPrepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        ruleDID
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
    });
    it("does not allow non-action handler to call removeRewardRule", async () => {
      await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        ruleDID,
        tallyRuleDID,
        benefitDID
      );
      await rewardManager
        .removeRewardRule(rewardProgramID, ruleDID)
        .should.be.rejectedWith(
          Error,
          "caller is not a registered action handler"
        );
    });
    it("does not allow non-action handler to call transfer on removeRewardRule", async () => {
      await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        ruleDID,
        tallyRuleDID,
        benefitDID
      );
      await daicpxdToken
        .transferAndCall(
          removeRewardRuleHandler.address,
          toTokenUnit(0),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, // doesn't matter what this is
              AbiCoder.encodeParameters(
                ["address", "string"],
                [rewardProgramID, ruleDID]
              ),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it("does not allow non-CPXD token to call removeRewardRule", async () => {
      await addRewardRule(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        0,
        undefined,
        rewardProgramID,
        ruleDID,
        tallyRuleDID,
        benefitDID
      );
      await fakeDaicpxdToken
        .transferAndCall(
          removeRewardRuleHandler.address,
          toTokenUnit(0),
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              prepaidCard.address,
              0, //doesn't matter what this is
              AbiCoder.encodeParameters(
                ["address", "string"],
                [rewardProgramID, ruleDID]
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
        (await rewardManager.rewardPrograms.call(rewardProgramID)).locked
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
        (await rewardManager.rewardPrograms.call(rewardProgramID)).locked
      ).to.equal(true);
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
        (await rewardManager.rewardPrograms.call(rewardProgramID)).locked
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
      rewardProgramID = randomHex(20);
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
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let startingRewardFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        rewardFeeReceiver
      );
      await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
        undefined,
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
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramID
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
    });
    it("reverts when rewardee doesn't have enough in their prepaid card for the rewardee registration fee amount", async () => {
      await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARDEE_REGISTRATION_FEE_IN_SPEND - 1,
        undefined,
        rewardProgramID
      ).should.be.rejectedWith(Error, "safe transaction was reverted");
    });
    it("refunds the prepaid card if the rewardee pays more than the registration fee", async () => {
      let startingPrepaidCardDaicpxdBalance = await getBalance(
        daicpxdToken,
        prepaidCard.address
      );
      let startingRewardFeeReceiverDaicpxdBalance = await getBalance(
        daicpxdToken,
        rewardFeeReceiver
      );
      await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARDEE_REGISTRATION_FEE_IN_SPEND + 1,
        undefined,
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

  describe("transfer reward safe", () => {
    let prepaidCard, rewardSafe;

    beforeEach(async () => {
      rewardProgramID = randomHex(20);
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
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
      await transferRewardSafe(
        rewardManager,
        rewardSafe,
        prepaidCardOwner,
        otherPrepaidCardOwner,
        relayer,
        daicpxdToken
      );
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
    });

    it("cannot transfer reward safe with swap owner directly to safe", async () => {
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
      ).should.be.rejectedWith(Error, "Signatures data too short");
    });

    it("cannot transfer reward safe swap owner full signature", async () => {
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
      ).should.be.rejectedWith(Error, "Invalid contract signature provided");
    });
    it("new owner can transfer reward safe after it has been transferred to them", async () => {
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        relayer,
        prepaidCardOwner,
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
      await transferRewardSafe(
        rewardManager,
        rewardSafe,
        prepaidCardOwner,
        otherPrepaidCardOwner,
        relayer,
        daicpxdToken
      );
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
      await transferRewardSafe(
        rewardManager,
        rewardSafe,
        otherPrepaidCardOwner,
        prepaidCardOwnerA,
        relayer,
        daicpxdToken
      );
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
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
      await transferRewardSafe(
        rewardManager,
        rewardSafe,
        prepaidCardOwner,
        otherPrepaidCardOwner,
        relayer,
        daicpxdToken
      );
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
      await transferRewardSafe(
        rewardManager,
        rewardSafe,
        prepaidCardOwner,
        prepaidCardOwnerA,
        relayer,
        daicpxdToken,
        rewardProgramID
      ).should.be.rejectedWith(Error, "Invalid owner provided");
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
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
      await transferRewardSafe(
        rewardManager,
        rewardSafe,
        prepaidCardOwnerA,
        otherPrepaidCardOwner,
        relayer,
        daicpxdToken
      );
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
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
      await transferRewardSafe(
        rewardManager,
        rewardSafe,
        prepaidCardOwnerB,
        otherPrepaidCardOwner,
        relayer,
        daicpxdToken
      );
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
    });
  });
});
