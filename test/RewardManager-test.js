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

const { randomHex } = require("web3").utils;
const { expect, TOKEN_DETAIL_DATA } = require("./setup");
const utils = require("./utils/general");
const { ZERO_ADDRESS } = utils;

const {
  toTokenUnit,
  shouldBeSameBalance,
  getBalance,
  setupExchanges,
  transferOwner,
  createPrepaidCards,
  addActionHandlers,
  registerRewardee,
  registerRewardProgram,
  createDepotFromSupplierMgr,
  transferRewardSafe,
  findAccountBeforeAddress,
  findAccountAfterAddress,
} = require("./utils/helper");

const { getParamsFromEvent } = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");
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
    merchantManager;
  // handlers
  let registerRewardeeHandler, registerRewardProgramHandler;

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
    prepaidCardOwner = accounts[3];
    relayer = accounts[4];
    merchantFeeReceiver = accounts[5];
    rewardFeeReceiver = accounts[6];
    otherPrepaidCardOwner = accounts[7];

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
      proxyFactory.address
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
    await revenuePool.setup(
      exchange.address,
      merchantManager.address,
      actionDispatcher.address,
      prepaidCardManager.address,
      merchantFeeReceiver,
      0,
      1000
    );
    await rewardManager.setup(
      actionDispatcher.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      rewardFeeReceiver,
      REWARDEE_REGISTRATION_FEE_IN_SPEND,
      REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND
    );
    await prepaidCardManager.addGasPolicy("transfer", false, true);
    await prepaidCardManager.addGasPolicy("split", true, true);

    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address
    );

    ({
      registerRewardeeHandler,
      registerRewardProgramHandler,
    } = await addActionHandlers(
      prepaidCardManager,
      revenuePool,
      actionDispatcher,
      merchantManager,
      tokenManager,
      rewardManager,
      owner,
      exchange.address,
      spendToken.address
    ));

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
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND
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
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND
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
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND
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
          0
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
      ({
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(5 + 1)]
      ));
      await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(1));
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        prepaidCardOwner,
        cardcpxdToken,
        relayer,
        daicpxdToken
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
        daicpxdToken,
        cardcpxdToken,
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
      ({
        prepaidCards: [otherPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(100)]
      ));
      await cardcpxdToken.mint(otherPrepaidCard.address, toTokenUnit(1));
      await transferOwner(
        prepaidCardManager,
        otherPrepaidCard,
        issuer,
        prepaidCardOwner,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      await registerRewardProgram(
        prepaidCardManager,
        otherPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
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
        daicpxdToken,
        cardcpxdToken,
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
        daicpxdToken,
        cardcpxdToken,
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
        daicpxdToken,
        cardcpxdToken,
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
    beforeEach(async () => {
      let prepaidCard;
      rewardProgramID = randomHex(20);
      ({
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(5 + 1)]
      ));
      await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(1));
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        prepaidCardOwner,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramAdmin,
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
    });
    it("cannot remove existing reward program if not owner", async () => {
      await rewardManager
        .removeRewardProgram(rewardProgramID, { from: rewardProgramAdmin })
        .should.be.rejectedWith("Ownable: caller is not the owner");
    });
    it("add rule in reward program", async () => {
      await rewardManager.addRewardRule(
        rewardProgramID,
        ruleDID,
        tallyRuleDID,
        benefitDID,
        { from: rewardProgramAdmin }
      );
      expect(
        await rewardManager.hasRule(rewardProgramID, ruleDID, {
          from: rewardProgramAdmin,
        })
      ).to.equal(true);
    });
    it("remove reward program", async () => {
      await rewardManager.addRewardRule(
        rewardProgramID,
        ruleDID,
        tallyRuleDID,
        benefitDID,
        { from: rewardProgramAdmin }
      );
      await rewardManager.removeRewardRule(rewardProgramID, ruleDID, {
        from: rewardProgramAdmin,
      });
      expect(await rewardManager.hasRule(rewardProgramID, ruleDID)).to.equal(
        false
      );
    });
    it("lock reward program", async () => {
      expect(await rewardManager.isLocked(rewardProgramID)).to.equal(false);
      await rewardManager.lockRewardProgram(rewardProgramID, {
        from: rewardProgramAdmin,
      });
      expect(await rewardManager.isLocked(rewardProgramID)).to.equal(true);
    });
    it("update rewardProgramAdmin of reward program", async () => {
      expect(await rewardManager.adminRewardProgram(rewardProgramID)).to.equal(
        rewardProgramAdmin
      );
      await rewardManager.updateAdmin(rewardProgramID, owner, {
        from: rewardProgramAdmin,
      });
      expect(await rewardManager.adminRewardProgram(rewardProgramID)).to.equal(
        owner
      );
    });
  });

  describe("rewardee registers for reward program", () => {
    let prepaidCard, otherPrepaidCard;
    beforeEach(async () => {
      rewardProgramID = randomHex(20);
      ({
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10 + 1)]
      ));
      await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(1));
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        prepaidCardOwner,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      );
    });
    it("register rewardee for reward program", async () => {
      expect(
        await rewardManager.hasRewardSafe(rewardProgramID, prepaidCardOwner)
      ).to.equal(false);
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
        daicpxdToken,
        cardcpxdToken,
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
      expect(
        await rewardManager.hasRewardSafe(rewardProgramID, prepaidCardOwner)
      ).to.equal(true);
    });

    it("does not allow non-action handler to call registerRewardee", async () => {
      await rewardManager
        .register(rewardProgramID, prepaidCardOwner)
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
        daicpxdToken,
        cardcpxdToken,
        relayer,
        prepaidCardOwner,
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramID
      );
      ({
        prepaidCards: [otherPrepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(5 + 1)]
      ));
      await cardcpxdToken.mint(otherPrepaidCard.address, toTokenUnit(1));
      await transferOwner(
        prepaidCardManager,
        otherPrepaidCard,
        issuer,
        prepaidCardOwner,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      await registerRewardee(
        prepaidCardManager,
        otherPrepaidCard,
        daicpxdToken,
        cardcpxdToken,
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
        daicpxdToken,
        cardcpxdToken,
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
        daicpxdToken,
        cardcpxdToken,
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
      ({
        prepaidCards: [prepaidCard],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(10 + 1)]
      ));
      await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(1));
      await transferOwner(
        prepaidCardManager,
        prepaidCard,
        issuer,
        prepaidCardOwner,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        prepaidCardOwner,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramAdmin,
        rewardProgramID
      );
    });
    it("transfer reward safe ownership", async () => {
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        prepaidCardOwner,
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramID
      );
      const rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARD_SAFE_CREATED,
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
        daicpxdToken,
        rewardSafe.address
      );
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
    });

    it("can sign with address lexigraphically after prepaid card manager contract address for transfer", async () => {
      let {
        prepaidCards: [prepaidCardA],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(5 + 1)]
      );
      await cardcpxdToken.mint(prepaidCardA.address, toTokenUnit(1));
      await transferOwner(
        prepaidCardManager,
        prepaidCardA,
        issuer,
        prepaidCardOwnerA,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCardA,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        prepaidCardOwnerA,
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramID
      );
      const rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARD_SAFE_CREATED,
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
        daicpxdToken,
        rewardSafe.address
      );
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
    });
    it("can sign with address lexigraphically before prepaid card manager contract address for transfer", async () => {
      let {
        prepaidCards: [prepaidCardB],
      } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        daicpxdToken,
        issuer,
        relayer,
        [toTokenUnit(5 + 1)]
      );
      await cardcpxdToken.mint(prepaidCardB.address, toTokenUnit(1));
      await transferOwner(
        prepaidCardManager,
        prepaidCardB,
        issuer,
        prepaidCardOwnerB,
        cardcpxdToken,
        relayer,
        daicpxdToken
      );
      const tx = await registerRewardee(
        prepaidCardManager,
        prepaidCardB,
        daicpxdToken,
        cardcpxdToken,
        relayer,
        prepaidCardOwnerB,
        REWARDEE_REGISTRATION_FEE_IN_SPEND,
        undefined,
        rewardProgramID
      );
      const rewardSafeCreation = await getParamsFromEvent(
        tx,
        eventABIs.REWARD_SAFE_CREATED,
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
        daicpxdToken,
        rewardSafe.address
      );
      owners = await rewardSafe.getOwners();
      expect(owners.length).to.equal(2);
      expect(owners[1]).to.equal(otherPrepaidCardOwner);
    });
  });
});
