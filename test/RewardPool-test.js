const PaymentTree = require("./utils/payment-tree");

const { assert, expect, TOKEN_DETAIL_DATA } = require("./setup");
const _ = require("lodash");

const ERC677Token = artifacts.require("ERC677Token.sol");

const RewardPool = artifacts.require("RewardPool.sol");
const GnosisSafe = artifacts.require("GnosisSafe");

const RewardSafeDelegateImplementation = artifacts.require(
  "RewardSafeDelegateImplementation"
);

const {
  ZERO_ADDRESS,
  getRewardSafeFromEventLog,
  checkGnosisExecution,
  getParamsFromEvent,
} = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");
const { setupProtocol, setupRoles } = require("./utils/setup");
const { BN } = require("web3-utils");
const {
  advanceBlock,
  toTokenUnit,
  getBalance,
  getPoolBalanceByRewardProgram,
  createPrepaidCardAndTransfer,
  registerRewardProgram,
  registerRewardee,
  claimReward,
  mintWalletAndRefillPool,
  payRewardTokens,
  recoverUnclaimedRewardTokens,
  registerMerchant,
  signAndSendSafeTransaction,
  generateRewardProgramID,
} = require("./utils/helper");
const AbiCoder = require("web3-eth-abi");

const REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND = 500;

contract("RewardPool", function (accounts) {
  let daicpxdToken, cardcpxdToken;

  let rewardManager,
    prepaidCardManager,
    tokenManager,
    actionDispatcher,
    gnosisSafeMasterCopy,
    payRewardTokensHandler,
    versionManager,
    proxyFactory,
    merchantManager;

  let owner, issuer, prepaidCardOwner, relayer, governanceAdmin;

  let depot, rewardSafe;
  let rewardProgramID, otherRewardProgramID;
  let tally;
  let rewardPool;
  let payments;
  let otherPayments;
  describe("Reward Pool", function () {
    let prepaidCard;
    before(async () => {
      ({ owner, tally, issuer, prepaidCardOwner, relayer, governanceAdmin } =
        setupRoles(accounts));

      // do not run this fixture inside a beforeEach
      // until we find a way to instantiate the objects that are only required
      ({
        actionDispatcher,
        gnosisSafeMasterCopy,
        proxyFactory,
        prepaidCardManager,
        rewardManager,
        depot,
        daicpxdToken,
        cardcpxdToken,
        tokenManager,
        merchantManager,
        versionManager,
        payRewardTokensHandler,
      } = await setupProtocol(accounts));
    });
    beforeEach(async function () {
      rewardPool = await RewardPool.new();
      await rewardPool.initialize(owner);
      await rewardPool.setup(
        tally,
        rewardManager.address,
        tokenManager.address,
        versionManager.address
      );
      let rewardFeeReceiver = accounts[5]; //same as in setupProtocol()
      // have to recall setup because reward pool is being created independently of setupProtocol

      let delegateImplementation = await RewardSafeDelegateImplementation.new();

      await rewardManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        rewardFeeReceiver,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        [rewardPool.address],
        governanceAdmin,
        delegateImplementation.address,
        versionManager.address
      );
      rewardProgramID = generateRewardProgramID();
      otherRewardProgramID = generateRewardProgramID();
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
        prepaidCardOwner,
        rewardProgramID
      );

      let currentBlockNumber = await web3.eth.getBlockNumber();

      payments = [
        {
          paymentCycleNumber: 1,
          validFrom: currentBlockNumber,
          validTo: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[11], //payee == rewardee
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(10),
        },
        {
          paymentCycleNumber: 1,
          validFrom: currentBlockNumber,
          validTo: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[12],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(12),
        },
        {
          paymentCycleNumber: 1,
          validFrom: currentBlockNumber,
          validTo: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[13],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(2),
        },
        {
          paymentCycleNumber: 1,
          validFrom: currentBlockNumber,
          validTo: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[14],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(1),
        },
        {
          paymentCycleNumber: 1,
          validFrom: currentBlockNumber,
          validTo: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[15],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(32),
        },
        {
          paymentCycleNumber: 1,
          validFrom: currentBlockNumber,
          validTo: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[18],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(101), // this amount is used to test logic when the payment pool doesn't have sufficient funds
        },
      ];
      otherPayments = [
        {
          paymentCycleNumber: 1,
          validFrom: currentBlockNumber,
          validTo: currentBlockNumber + 10000,
          rewardProgramID: otherRewardProgramID,
          payee: accounts[16],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(10),
        },
        {
          paymentCycleNumber: 1,
          validFrom: currentBlockNumber,
          validTo: currentBlockNumber + 10000,
          rewardProgramID: otherRewardProgramID,
          payee: accounts[17],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(9),
        },
        {
          paymentCycleNumber: 1,
          validFrom: currentBlockNumber,
          validTo: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[18],
          token: cardcpxdToken.address,
          tokenType: 2, // reserved for NFTs/other token types
          amount: 1,
        },
      ];
    });

    afterEach(async function () {
      let balance = await cardcpxdToken.balanceOf(accounts[11]);
      await cardcpxdToken.burn(balance, { from: accounts[11] });
    });

    describe("initial reward pool contract", () => {
      it("reverts when tally is set to zero address", async () => {
        await rewardPool
          .setup(
            ZERO_ADDRESS,
            rewardManager.address,
            tokenManager.address,
            versionManager.address
          )
          .should.be.rejectedWith(Error, "Tally should not be zero address");
      });

      it("reverts when reward manager is set to zero address", async () => {
        await rewardPool
          .setup(
            tally,
            ZERO_ADDRESS,
            tokenManager.address,
            versionManager.address
          )
          .should.be.rejectedWith(
            Error,
            "Reward Manager should not be zero address"
          );
      });
      it("check reward pool parameters", async () => {
        expect(await rewardPool.tally()).to.equal(tally);
        expect(await rewardPool.rewardManager()).to.equal(
          rewardManager.address
        );
      });
    });

    describe("submitPayeeMerkleRoot", function () {
      it("does not allow submitting a merkle root for an unregistered reward program", async function () {
        let randomInvalidProgramID = generateRewardProgramID();
        let merkleTree = new PaymentTree(payments);
        let root = merkleTree.getHexRoot();
        await rewardPool
          .submitPayeeMerkleRoot(randomInvalidProgramID, 1, root, {
            from: tally,
          })
          .should.be.rejectedWith(
            Error,
            "Can only submit a root for a registered reward program"
          );
      });
      it("can submit a new merkle root for a payment cycle", async function () {
        let merkleTree = new PaymentTree(payments);
        let root = merkleTree.getHexRoot();
        let paymentCycleNumber = 1;
        let txn = await rewardPool.submitPayeeMerkleRoot(
          rewardProgramID,
          paymentCycleNumber,
          root,
          {
            from: tally,
          }
        );

        assert.equal(
          txn.logs.length,
          1,
          "the correct number of events were fired"
        );

        const merkleRootSubmissionEvent = _.find(txn.logs, {
          event: "MerkleRootSubmission",
        });

        assert.equal(
          merkleRootSubmissionEvent.args.paymentCycle.toNumber(),
          paymentCycleNumber,
          "the payment cycle number is correct"
        );

        assert.equal(
          merkleRootSubmissionEvent.args.rewardProgramID.toLowerCase(),
          rewardProgramID.toLowerCase(),
          "the reward program ID is correct"
        );
      });

      it("allows multiple merkle roots for the same reward program to be submitted", async function () {
        let merkleTree = new PaymentTree(payments);
        let root = merkleTree.getHexRoot();
        await rewardPool.submitPayeeMerkleRoot(rewardProgramID, 1, root, {
          from: tally,
        });
        // This should not throw any errors
        await rewardPool.submitPayeeMerkleRoot(rewardProgramID, 2, root, {
          from: tally,
        });
      });

      it("allows multiple merkle roots for different reward programs to be submitted with the same payment cycle number", async function () {
        let merkleTree = new PaymentTree(payments);
        let root = merkleTree.getHexRoot();
        await registerRewardProgram(
          prepaidCardManager,
          prepaidCard,
          relayer,
          prepaidCardOwner,
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
          undefined,
          prepaidCardOwner,
          otherRewardProgramID
        );
        await rewardPool.submitPayeeMerkleRoot(rewardProgramID, 1, root, {
          from: tally,
        });

        // This should not throw any errors
        await rewardPool.submitPayeeMerkleRoot(otherRewardProgramID, 1, root, {
          from: tally,
        });
      });

      it("does not allow a root to be submitted twice for the same reward program and cycle", async function () {
        let merkleTree = new PaymentTree(payments);
        let root = merkleTree.getHexRoot();
        await rewardPool.submitPayeeMerkleRoot(rewardProgramID, 1, root, {
          from: tally,
        });

        await rewardPool
          .submitPayeeMerkleRoot(rewardProgramID, 1, root, {
            from: tally,
          })
          .should.be.rejectedWith(
            Error,
            "Payee root already submitted for this program & cycle"
          );
      });

      it("does not allow non-tally to submit merkle root", async function () {
        let merkleTree = new PaymentTree(payments);
        let root = merkleTree.getHexRoot();

        await rewardPool
          .submitPayeeMerkleRoot(rewardProgramID, 1, root, {
            from: accounts[11],
          })
          .should.be.rejectedWith(Error, "Caller is not tally");

        await rewardPool
          .submitPayeeMerkleRoot(rewardProgramID, 1, root, { from: owner })
          .should.be.rejectedWith(Error, "Caller is not tally");
      });
    });

    describe("claim", function () {
      let rewardPoolBalance;
      let proof;
      let payeeIndex = 0;
      let payee;
      let paymentAmount;
      let merkleTree;
      let root;
      let leaf;
      let otherMerkleTree;
      let otherRoot;
      let rewardeePrepaidCard;
      let rewardSafePreviousBalance, rewardPoolPreviousBalance;

      beforeEach(async function () {
        payee = payments[payeeIndex].payee;
        paymentAmount = payments[payeeIndex].amount;
        merkleTree = new PaymentTree(payments);
        root = merkleTree.getHexRoot();
        rewardPoolBalance = toTokenUnit(100);

        await registerRewardProgram(
          prepaidCardManager,
          prepaidCard,
          relayer,
          prepaidCardOwner,
          REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
          undefined,
          prepaidCardOwner,
          otherRewardProgramID
        );

        await mintWalletAndRefillPool(
          cardcpxdToken,
          rewardPool,
          prepaidCardOwner,
          rewardPoolBalance,
          rewardProgramID
        );

        leaf = merkleTree.getLeaf(payments[payeeIndex]);
        proof = merkleTree.getProof(payments[payeeIndex]);
        await rewardPool.submitPayeeMerkleRoot(
          rewardProgramID,
          payments[0]["paymentCycleNumber"],
          root,
          {
            from: tally,
          }
        );
        otherMerkleTree = new PaymentTree(otherPayments);
        otherRoot = otherMerkleTree.getHexRoot();
        await rewardPool.submitPayeeMerkleRoot(
          otherPayments[0]["rewardProgramID"],
          otherPayments[0]["paymentCycleNumber"],
          otherRoot,
          {
            from: tally,
          }
        );
        rewardeePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          payee
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          rewardeePrepaidCard,
          relayer,
          payee,
          undefined,
          rewardProgramID
        );
        rewardSafe = await getRewardSafeFromEventLog(tx, rewardManager.address);

        rewardSafePreviousBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        rewardPoolPreviousBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );
      });

      it("payee/rewardee can claim from the pool", async function () {
        const {
          safeTx,
          executionResult: { gasFee },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          cardcpxdToken,
          leaf,
          proof
        );

        let rewardSafeBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        let rewardPoolBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );
        let hasClaimed = await rewardPool.claimed(leaf, { from: payee });
        assert(hasClaimed, "the payee has claimed");
        assert(
          rewardSafeBalance.eq(
            rewardSafePreviousBalance.add(paymentAmount).sub(gasFee)
          ),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalance.sub(paymentAmount)),
          "the pool balance is correct"
        );

        let params = await getParamsFromEvent(
          safeTx,
          eventABIs.REWARDEE_CLAIM,
          rewardPool.address
        );
        expect(params.length).to.equal(1);
        expect(params[0]).to.deep.include({
          rewardProgramID,
          rewardee: payee,
          rewardSafe: rewardSafe.address,
          token: cardcpxdToken.address,
          amount: paymentAmount.toString(),
          leaf,
        });
      });

      it("payee/rewardee cannot claim using an eoa", async function () {
        await rewardPool
          .claim(leaf, proof, false, {
            from: payee,
          })
          .should.be.rejectedWith(
            Error,
            "Transaction reverted: function call to a non-contract account"
          );
      });
      it("payee/rewardee cannot claim from a safe associated with different reward program", async function () {
        let aPayee = payments[0].payee;

        rewardeePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          aPayee
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          rewardeePrepaidCard,
          relayer,
          aPayee,
          undefined,
          otherRewardProgramID
        );
        let otherRewardSafe = await getRewardSafeFromEventLog(
          tx,
          rewardManager.address
        );
        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          otherRewardSafe,
          aPayee,
          cardcpxdToken,
          leaf,
          proof
        ).should.be.rejectedWith(
          Error,
          "can only withdraw for safe registered on reward program"
        );
      });

      it("non-payee cannot claim from pool", async function () {
        let aPayee = accounts[1];
        let somePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          aPayee
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          somePrepaidCard,
          relayer,
          aPayee,
          undefined,
          rewardProgramID
        );

        let someRewardSafe = await getRewardSafeFromEventLog(
          tx,
          rewardManager.address
        );

        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          someRewardSafe,
          aPayee,
          cardcpxdToken,
          leaf,
          proof //this is the wrong proof
        ).should.be.rejectedWith(Error, "Can only be claimed by payee");
      });

      it("payee/rewardee cannot claim their allotted tokens from the pool when the pool does not have enough tokens", async function () {
        let payeeIndex = 5;
        let rewardee = payments[payeeIndex].payee;
        let paymentAmountAbove100 = payments[payeeIndex].amount;
        let proof = merkleTree.getProof(payments[payeeIndex]);
        let leaf = merkleTree.getLeaf(payments[payeeIndex]);

        assert(
          paymentAmountAbove100.gt(rewardPoolPreviousBalance),
          "reward pool does not have enough balance"
        );
        let somePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          rewardee
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          somePrepaidCard,
          relayer,
          rewardee,
          undefined,
          rewardProgramID
        );
        let someRewardSafe = await getRewardSafeFromEventLog(
          tx,
          rewardManager.address
        );
        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          someRewardSafe,
          rewardee,
          cardcpxdToken,
          leaf,
          proof
        ).should.be.rejectedWith(Error, "Reward pool has insufficient balance");
      });

      it("payee/rewardee cannot claim their allotted tokens from the pool when the reward program does not have enough tokens in the pool and don't want to allow partial claims", async function () {
        let payeeIndex = 1;
        let rewardee = otherPayments[payeeIndex].payee;
        let proof = otherMerkleTree.getProof(otherPayments[payeeIndex]);
        let leaf = otherMerkleTree.getLeaf(otherPayments[payeeIndex]);

        let somePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          rewardee
        );
        await mintWalletAndRefillPool(
          cardcpxdToken,
          rewardPool,
          prepaidCardOwner,
          toTokenUnit(5),
          otherRewardProgramID
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          somePrepaidCard,
          relayer,
          rewardee,
          undefined,
          otherRewardProgramID
        );
        let someRewardSafe = await getRewardSafeFromEventLog(
          tx,
          rewardManager.address
        );
        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          someRewardSafe,
          rewardee,
          cardcpxdToken,
          leaf,
          proof
        ).should.be.rejectedWith(
          Error,
          "Reward program has insufficient balance inside reward pool"
        );
      });

      it("payee/rewardee can claim the remaining tokens from a pool when the reward program does not have enough tokens in the pool and the user does want to allow partial claims", async function () {
        let payeeIndex = 1;
        let rewardee = otherPayments[payeeIndex].payee;
        let proof = otherMerkleTree.getProof(otherPayments[payeeIndex]);
        let leaf = otherMerkleTree.getLeaf(otherPayments[payeeIndex]);

        let somePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          rewardee
        );
        await mintWalletAndRefillPool(
          cardcpxdToken,
          rewardPool,
          prepaidCardOwner,
          toTokenUnit(5),
          otherRewardProgramID
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          somePrepaidCard,
          relayer,
          rewardee,
          undefined,
          otherRewardProgramID
        );
        let someRewardSafe = await getRewardSafeFromEventLog(
          tx,
          rewardManager.address
        );

        let rewardSafePreviousBalance = await getBalance(
          cardcpxdToken,
          someRewardSafe.address
        );

        const {
          executionResult: { gasFee },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          someRewardSafe,
          rewardee,
          cardcpxdToken,
          leaf,
          proof,
          true
        ).should.not.be.rejectedWith(Error, "Reward program balance is empty");

        let rewardSafeBalance = await getBalance(
          cardcpxdToken,
          someRewardSafe.address
        );

        assert(
          rewardSafeBalance.eq(
            rewardSafePreviousBalance.add(toTokenUnit(5)).sub(gasFee)
          ),
          "the reward safe balance is correct"
        );
      });

      it("payee/rewardee cannot claim their allotted tokens from the pool even when they allow partial claims if the reward program is empty", async function () {
        let payeeIndex = 1;
        let rewardee = otherPayments[payeeIndex].payee;
        let proof = otherMerkleTree.getProof(otherPayments[payeeIndex]);
        let leaf = otherMerkleTree.getLeaf(otherPayments[payeeIndex]);

        let somePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          rewardee
        );

        const tx = await registerRewardee(
          prepaidCardManager,
          somePrepaidCard,
          relayer,
          rewardee,
          undefined,
          otherRewardProgramID
        );
        let someRewardSafe = await getRewardSafeFromEventLog(
          tx,
          rewardManager.address
        );
        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          someRewardSafe,
          rewardee,
          cardcpxdToken,
          leaf,
          proof,
          true
        ).should.be.rejectedWith(Error, "Reward program balance is empty");
      });

      it("non-payee cannot claim NFT token types yet", async function () {
        // This test is expected to fail if you have implemented NFT token type
        // claims
        let payment = otherPayments[2];
        let merkleTree = new PaymentTree(otherPayments);
        let leaf = merkleTree.getLeaf(payment);
        let proof = merkleTree.getProof(payment);
        let payee = payment.payee;
        let somePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          payee
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          somePrepaidCard,
          relayer,
          payee,
          undefined,
          rewardProgramID
        );

        let someRewardSafe = await getRewardSafeFromEventLog(
          tx,
          rewardManager.address
        );

        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          someRewardSafe,
          payee,
          cardcpxdToken,
          leaf,
          proof
        ).should.be.rejectedWith(Error, "Token type currently unsupported");
      });

      it("payee/rewardee can claim their allotted amount from an older proof", async function () {
        let updatedPayments = [];
        for (var i = 0; i < payments.length; i++) {
          let payment = Object.assign({}, payments[i]);
          payment["paymentCycleNumber"] += 1;
          updatedPayments.push(payment);
        }
        let updatedMerkleTree = new PaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        let updatedProof = updatedMerkleTree.getProof(
          updatedPayments[payeeIndex]
        );
        let updatedLeaf = updatedMerkleTree.getLeaf(
          updatedPayments[payeeIndex]
        );

        await advanceBlock(web3);

        await rewardPool.submitPayeeMerkleRoot(
          updatedPayments[0]["rewardProgramID"],
          updatedPayments[0]["paymentCycleNumber"],
          updatedRoot,
          { from: tally }
        );

        let claimAmount = payments[payeeIndex].amount;

        const {
          executionResult: { gasFee },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          cardcpxdToken,
          leaf,
          proof
        );

        let rewardSafeBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        let rewardPoolBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );

        let claimed = await rewardPool.claimed(leaf, proof);

        let updatedClaimed = await rewardPool.claimed(
          updatedLeaf,
          updatedProof
        );
        assert(
          rewardSafeBalance.eq(
            rewardSafePreviousBalance.add(claimAmount).sub(gasFee)
          ),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalance.sub(claimAmount)),
          "the pool balance is correct"
        );
        assert(claimed, "the original proof has been claimed");
        assert(!updatedClaimed, "the new proof has not been claimed");
      });

      it("payee/rewardee can claim their allotted amount from a newer proof", async function () {
        let updatedPayments = [];
        for (var i = 0; i < payments.length; i++) {
          let payment = Object.assign({}, payments[i]);
          payment["paymentCycleNumber"] += 1;
          updatedPayments.push(payment);
        }
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
        let updatedMerkleTree = new PaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let updatedProof = updatedMerkleTree.getProof(
          updatedPayments[payeeIndex]
        );
        let updatedLeaf = updatedMerkleTree.getLeaf(
          updatedPayments[payeeIndex]
        );

        await rewardPool.submitPayeeMerkleRoot(
          updatedPayments[0]["rewardProgramID"],
          updatedPayments[0]["paymentCycleNumber"],
          updatedRoot,
          { from: tally }
        );

        const {
          executionResult: { gasFee },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          cardcpxdToken,
          updatedLeaf,
          updatedProof
        );

        let rewardSafeBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        let rewardPoolBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );

        let claimed = await rewardPool.claimed(leaf, proof);

        let updatedClaimed = await rewardPool.claimed(
          updatedLeaf,
          updatedProof
        );

        assert(
          rewardSafeBalance.eq(
            rewardSafePreviousBalance.add(updatedPaymentAmount).sub(gasFee)
          ),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(
            rewardPoolPreviousBalance.sub(updatedPaymentAmount)
          ),
          "the pool balance is correct"
        );
        assert(!claimed, "the original proof has not been claimed");
        assert(updatedClaimed, "the new proof has been claimed");
      });

      it("payee/rewardee can claim their allotted amount from a newer proof even after claim from older proof", async function () {
        let updatedPayments = [];
        for (var i = 0; i < payments.length; i++) {
          let payment = Object.assign({}, payments[i]);
          payment["paymentCycleNumber"] += 1;
          updatedPayments.push(payment);
        }
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
        let updatedMerkleTree = new PaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let updatedProof = updatedMerkleTree.getProof(
          updatedPayments[payeeIndex]
        );
        let updatedLeaf = updatedMerkleTree.getLeaf(
          updatedPayments[payeeIndex]
        );

        await rewardPool.submitPayeeMerkleRoot(
          updatedPayments[0]["rewardProgramID"],
          updatedPayments[0]["paymentCycleNumber"],
          updatedRoot,
          { from: tally }
        );

        const {
          executionResult: { gasFee: gasFeeClaimFromOlderProof },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          cardcpxdToken,
          leaf,
          proof
        );

        let rewardSafeBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        let rewardPoolBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );
        assert(
          rewardSafeBalance.eq(
            rewardSafePreviousBalance
              .add(paymentAmount)
              .sub(gasFeeClaimFromOlderProof)
          ),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalance.sub(paymentAmount)),
          "the pool balance is correct"
        );
        //claim from newer proof
        const {
          executionResult: { gasFee: gasFeeClaimFromNewerProof },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          cardcpxdToken,
          updatedLeaf,
          updatedProof
        );
        rewardSafeBalance = await getBalance(cardcpxdToken, rewardSafe.address);
        rewardPoolBalance = await getBalance(cardcpxdToken, rewardPool.address);

        assert(
          rewardSafeBalance.eq(
            rewardSafePreviousBalance
              .add(paymentAmount)
              .add(updatedPaymentAmount)
              .sub(gasFeeClaimFromOlderProof)
              .sub(gasFeeClaimFromNewerProof)
          ),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(
            rewardPoolPreviousBalance
              .sub(paymentAmount)
              .sub(updatedPaymentAmount)
          ),
          "the pool balance is correct"
        );
      });
    });

    describe("verify", function () {
      let rewardPoolBalance;
      let proof;
      let payeeIndex = 0;
      let payee;
      let payments;
      let merkleTree;
      let root;
      let leaf;
      let rewardeePrepaidCard;
      let rewardSafePreviousBalance, rewardPoolPreviousBalance;

      beforeEach(async function () {
        let currentBlockNumber = await web3.eth.getBlockNumber();
        payments = [
          {
            paymentCycleNumber: 1,
            validFrom: currentBlockNumber,
            validTo: currentBlockNumber + 10000,
            rewardProgramID: rewardProgramID,
            payee: accounts[1],
            tokenType: 0, // Token type of 0 means that this is not a token
            data: "I am important data",
          },
          {
            paymentCycleNumber: 1,
            validFrom: currentBlockNumber,
            validTo: currentBlockNumber + 10000,
            rewardProgramID: rewardProgramID,
            payee: accounts[2],
            token: cardcpxdToken.address,
            tokenType: 1,
            amount: toTokenUnit(10),
          },
          {
            paymentCycleNumber: 1,
            validFrom: currentBlockNumber + 1000,
            validTo: currentBlockNumber + 10000,
            rewardProgramID: rewardProgramID,
            payee: accounts[1],
            tokenType: 0, // Token type of 0 means that this is not a token
            data: "I am not valid yet",
          },
          {
            paymentCycleNumber: 1,
            validFrom: currentBlockNumber - 1,
            validTo: currentBlockNumber - 1,
            rewardProgramID: rewardProgramID,
            payee: accounts[1],
            tokenType: 0, // Token type of 0 means that this is not a token
            data: "I am expired",
          },
        ];
        payee = payments[payeeIndex].payee;
        merkleTree = new PaymentTree(payments);
        root = merkleTree.getHexRoot();
        rewardPoolBalance = toTokenUnit(100);
        await mintWalletAndRefillPool(
          cardcpxdToken,
          rewardPool,
          prepaidCardOwner,
          rewardPoolBalance,
          rewardProgramID
        );
        leaf = merkleTree.getLeaf(payments[payeeIndex]);
        proof = merkleTree.getProof(payments[payeeIndex]);
        await rewardPool.submitPayeeMerkleRoot(
          payments[0]["rewardProgramID"],
          payments[0]["paymentCycleNumber"],
          root,
          { from: tally }
        );
        rewardeePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          payee
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          rewardeePrepaidCard,
          relayer,
          payee,
          undefined,
          rewardProgramID
        );
        rewardSafe = await getRewardSafeFromEventLog(tx, rewardManager.address);

        rewardSafePreviousBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        rewardPoolPreviousBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );
      });
      it("payee/rewardee cannot claim if the node is non-claimable (only verifiable)", async function () {
        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          cardcpxdToken,
          leaf,
          proof
        ).should.be.rejectedWith(
          Error,
          "Non-claimable proof, use valid(leaf, proof) to check validity"
        );

        let claimed = await rewardPool.claimed(leaf, { from: payee });

        let rewardSafeBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        rewardPoolBalance = await getBalance(cardcpxdToken, rewardPool.address);
        assert(
          rewardSafeBalance.eq(rewardSafePreviousBalance),
          "the reward safe balance is not changed"
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalance),
          "the pool balance is not changed"
        );
        assert(!claimed, "the original proof has not been claimed");
      });

      it("payee can validate their data", async function () {
        let valid = await rewardPool.valid(leaf, proof, { from: payee });
        let claimed = await rewardPool.claimed(leaf, { from: payee });
        assert(valid, "the data can be validated");
        assert(
          !claimed,
          "the data is not marked as claimed when checking for valid status"
        );
      });

      it("Anyone can validate a users data", async function () {
        let valid = await rewardPool.valid(leaf, proof, {
          from: payments[1].payee,
        });
        assert(valid, "the data can be validated");
      });

      it("Altering the leaf data makes it invalid", async function () {
        let payment = Object.assign({}, payments[payeeIndex]);
        payment["data"] = "Haha, secretly changed my data";
        let fakeLeaf = merkleTree.getLeaf(payment);
        let valid = await rewardPool.valid(fakeLeaf, proof, {
          from: payments[payeeIndex].payee,
        });
        assert(!valid, "Altering the data stops the valid check from working");
      });

      it("Validity checking tests the block number is on or after the first allowed", async function () {
        let earlyPayment = payments[2];
        let earlyLeaf = merkleTree.getLeaf(earlyPayment);
        let proof = merkleTree.getProof(earlyPayment);
        let valid = await rewardPool.valid(earlyLeaf, proof, {
          from: earlyPayment.payee,
        });
        assert(!valid, "Should be invalid if the valid range is in the future");
      });

      it("Validity checking tests the block number is before the last allowed", async function () {
        let latePayment = payments[3];
        let invalidLeaf = merkleTree.getLeaf(latePayment);
        let proof = merkleTree.getProof(latePayment);
        let valid = await rewardPool.valid(invalidLeaf, proof, {
          from: latePayment.payee,
        });
        assert(!valid, "Should be invalid if it has expired");
      });
    });

    describe("multi-token support", () => {
      let rewardPoolBalance;
      let payee;
      let merkleTree;
      let root;
      let rewardSafe, rewardeePrepaidCard;

      let rewardPoolPreviousBalanceCard,
        rewardPoolPreviousBalanceDai,
        rewardSafePreviousBalanceCard,
        rewardSafePreviousBalanceDai;

      beforeEach(async function () {
        let currentBlockNumber = await web3.eth.getBlockNumber();
        payee = accounts[11];
        payments = [
          {
            paymentCycleNumber: 1,
            validFrom: currentBlockNumber,
            validTo: currentBlockNumber + 10000,
            rewardProgramID: rewardProgramID,
            payee: payee,
            tokenType: 1,
            token: daicpxdToken.address,
            amount: toTokenUnit(10),
          },
          {
            paymentCycleNumber: 1,
            validFrom: currentBlockNumber,
            validTo: currentBlockNumber + 10000,
            rewardProgramID: rewardProgramID,
            payee: payee,
            tokenType: 1,
            token: cardcpxdToken.address,
            amount: toTokenUnit(100),
          },
        ];

        rewardPoolBalance = toTokenUnit(500);
        await mintWalletAndRefillPool(
          cardcpxdToken,
          rewardPool,
          prepaidCardOwner,
          rewardPoolBalance,
          rewardProgramID
        );
        await mintWalletAndRefillPool(
          daicpxdToken,
          rewardPool,
          prepaidCardOwner,
          rewardPoolBalance,
          rewardProgramID
        );
        await daicpxdToken.mint(rewardPool.address, rewardPoolBalance);

        merkleTree = new PaymentTree(payments);
        root = merkleTree.getHexRoot();

        await rewardPool.submitPayeeMerkleRoot(
          payments[0]["rewardProgramID"],
          payments[0]["paymentCycleNumber"],
          root,
          { from: tally }
        );

        rewardeePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          payee
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          rewardeePrepaidCard,
          relayer,
          payee,
          undefined,
          rewardProgramID
        );
        rewardSafe = await getRewardSafeFromEventLog(tx, rewardManager.address);

        rewardPoolPreviousBalanceCard = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );
        rewardPoolPreviousBalanceDai = await getBalance(
          daicpxdToken,
          rewardPool.address
        );
        rewardSafePreviousBalanceCard = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        rewardSafePreviousBalanceDai = await getBalance(
          daicpxdToken,
          rewardSafe.address
        );
      });

      it("claim from two different tokens", async () => {
        const cardAmount = toTokenUnit(100);
        const daiAmount = toTokenUnit(10);
        const cardProof = merkleTree.getProof(payments[1]);
        const cardLeaf = merkleTree.getLeaf(payments[1]);
        const daiProof = merkleTree.getProof(payments[0]);
        const daiLeaf = merkleTree.getLeaf(payments[0]);

        const {
          executionResult: { gasFee: gasFeeCardClaim },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          cardcpxdToken,
          cardLeaf,
          cardProof
        );

        const {
          executionResult: { gasFee: gasFeeDaiClaim },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          daicpxdToken,
          daiLeaf,
          daiProof
        );

        const rewardSafeBalanceCard = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        let rewardPoolBalanceCard = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );

        const rewardSafeBalanceDai = await getBalance(
          daicpxdToken,
          rewardSafe.address
        );
        let rewardPoolBalanceDai = await getBalance(
          daicpxdToken,
          rewardPool.address
        );
        assert(
          rewardSafeBalanceCard.eq(
            rewardSafePreviousBalanceCard.add(cardAmount).sub(gasFeeCardClaim)
          ),
          "the reward safe balance is correct"
        );

        assert(
          rewardPoolBalanceCard.eq(
            rewardPoolPreviousBalanceCard.sub(cardAmount)
          ),
          "the pool balance is correct"
        );

        assert(
          rewardSafeBalanceDai.eq(
            rewardSafePreviousBalanceDai.add(daiAmount).sub(gasFeeDaiClaim)
          ),
          "the reward safe balance is correct"
        );

        assert(
          rewardPoolBalanceDai.eq(rewardPoolPreviousBalanceDai.sub(daiAmount)),
          "the pool balance is correct"
        );
      });
    });
    describe("addRewardTokens", function () {
      let rewardPoolPreviousBalance, rewardProgramAdminPreviousBalance;

      beforeEach(async function () {
        rewardPoolPreviousBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );
        await cardcpxdToken.mint(prepaidCardOwner, toTokenUnit(100));
        rewardProgramAdminPreviousBalance = await getBalance(
          cardcpxdToken,
          prepaidCardOwner
        );
      });

      it("reward pool can be refilled using an eoa", async function () {
        await cardcpxdToken.transferAndCall(
          rewardPool.address,
          toTokenUnit(50),
          AbiCoder.encodeParameters(["address"], [rewardProgramID]),
          { from: prepaidCardOwner }
        );
        let rewardPoolBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );
        let rewardProgramAdminBalance = await getBalance(
          cardcpxdToken,
          prepaidCardOwner
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalance.add(toTokenUnit(50))),
          "the pool balance is correct"
        );
        assert(
          rewardProgramAdminBalance.eq(
            rewardProgramAdminPreviousBalance.sub(toTokenUnit(50))
          ),
          "the reward program admin balance is correct"
        );
      });
      it("reward pool cannot be refilled if reward program is unknown", async function () {
        await cardcpxdToken.mint(prepaidCardOwner, toTokenUnit(100));
        await cardcpxdToken
          .transferAndCall(
            rewardPool.address,
            toTokenUnit(50),
            AbiCoder.encodeParameters(["address"], [generateRewardProgramID()]),
            { from: prepaidCardOwner }
          )
          .should.be.rejectedWith(Error, "reward program is not found");
      });
      it("reward pool cannot be refilled with token not federated by token manager", async function () {
        const fakeToken = await ERC677Token.new();
        await fakeToken.initialize(...TOKEN_DETAIL_DATA, owner);
        await fakeToken.mint(prepaidCardOwner, toTokenUnit(100));
        await fakeToken
          .transferAndCall(
            rewardPool.address,
            toTokenUnit(50),
            AbiCoder.encodeParameters(["address"], [rewardProgramID]),
            { from: prepaidCardOwner }
          )
          .should.be.rejectedWith(Error, "calling token is unaccepted");
      });
      it("reward pool can be refilled using a prepaid card", async function () {
        await payRewardTokensHandler.setup(
          actionDispatcher.address,
          tokenManager.address,
          rewardPool.address,
          prepaidCardManager.address,
          versionManager.address
        );
        const rewardPoolPreviousBalanceDai = await getBalance(
          daicpxdToken,
          rewardPool.address
        );
        prepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          prepaidCardOwner
        );
        expect(
          await prepaidCardManager.hasBeenUsed.call(prepaidCard.address)
        ).to.equal(false);
        const prepaidCardPreviousBalanceDai = await getBalance(
          daicpxdToken,
          prepaidCard.address
        );
        let txn = await payRewardTokens(
          prepaidCardManager,
          prepaidCard,
          relayer,
          prepaidCardOwner,
          500,
          undefined,
          rewardProgramID
        );
        expect(
          await prepaidCardManager.hasBeenUsed.call(prepaidCard.address)
        ).to.equal(true);
        const { gasFee, success } = checkGnosisExecution(
          txn,
          prepaidCard.address
        );
        assert(success, "gnosis execution succesfull");
        const rewardPoolBalanceDai = await getBalance(
          daicpxdToken,
          rewardPool.address
        );

        const rewardPoolBalanceDaiByRewardProgram =
          await getPoolBalanceByRewardProgram(
            rewardProgramID,
            rewardPool,
            daicpxdToken
          );
        const prepaidCardBalanceDai = await getBalance(
          daicpxdToken,
          prepaidCard.address
        );
        assert(
          rewardPoolPreviousBalanceDai
            .add(rewardPoolBalanceDai)
            .eq(new BN("5000000000000000000")),
          "the reward pool balance is correct"
        );
        assert(
          rewardPoolBalanceDaiByRewardProgram.eq(new BN("5000000000000000000")),
          "the reward pool balance is correct"
        );
        assert(
          prepaidCardPreviousBalanceDai
            .sub(new BN("5000000000000000000"))
            .sub(gasFee)
            .eq(prepaidCardBalanceDai),
          "the prepaid card token balance is correct"
        );
      });
    });

    describe("recoverUnclaimedRewardTokens", function () {
      let rewardSafe, amountTokensAdded;
      beforeEach(async function () {
        await cardcpxdToken.mint(prepaidCardOwner, toTokenUnit(100));
        amountTokensAdded = toTokenUnit(50);
        let prepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          prepaidCardOwner
        );
        await cardcpxdToken.transferAndCall(
          rewardPool.address,
          amountTokensAdded,
          AbiCoder.encodeParameters(["address"], [rewardProgramID]),
          { from: prepaidCardOwner }
        );
        let tx = await registerRewardee(
          prepaidCardManager,
          prepaidCard,
          relayer,
          prepaidCardOwner,
          undefined,
          rewardProgramID
        );
        rewardSafe = await getRewardSafeFromEventLog(tx, rewardManager.address);
      });

      it("recover unclaimed reward tokens using reward safe owned reward program admin", async function () {
        const {
          executionResult: { gasFee },
        } = await recoverUnclaimedRewardTokens(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          prepaidCardOwner,
          rewardProgramID,
          cardcpxdToken,
          amountTokensAdded
        );
        let rewardSafeBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        assert(
          rewardSafeBalance.eq(amountTokensAdded.sub(gasFee)),
          "reward safe balance is correct"
        );
        let rewardPoolBalance = await rewardPool.rewardBalance(
          rewardProgramID,
          cardcpxdToken.address
        );
        assert(
          rewardPoolBalance.eq(toTokenUnit(0)),
          "reward pool balance is correct"
        );
      });

      it("cannot recover if owner of safe is not reward program admin", async function () {
        let prepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          owner
        );
        let tx = await registerRewardee(
          prepaidCardManager,
          prepaidCard,
          relayer,
          owner,
          undefined,
          rewardProgramID
        );
        rewardSafe = await getRewardSafeFromEventLog(tx, rewardManager.address);
        await recoverUnclaimedRewardTokens(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          owner,
          rewardProgramID,
          cardcpxdToken,
          amountTokensAdded
        ).should.be.rejectedWith(
          Error,
          "owner of safe is not reward program admin"
        );
      });

      it("cannot recover if insufficient funds in reward program", async function () {
        await recoverUnclaimedRewardTokens(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          prepaidCardOwner,
          rewardProgramID,
          cardcpxdToken,
          amountTokensAdded.add(toTokenUnit(10))
        ).should.be.rejectedWith(Error, "not enough tokens to withdraw");
      });
      it("recover unclaimed reward tokens using merchant safe owned reward program admin", async function () {
        let merchant = prepaidCardOwner;
        let merchantPrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1),
          merchant
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
        let merchantSafe = merchantCreation[0]["merchantSafe"];
        let recoverTokens = rewardPool.contract.methods.recoverTokens(
          rewardProgramID,
          cardcpxdToken.address,
          amountTokensAdded
        );
        let payload = recoverTokens.encodeABI();
        let gasEstimate = await recoverTokens.estimateGas({
          from: merchantSafe,
        });
        let safeTxData = {
          to: rewardPool.address,
          data: payload,
          txGasEstimate: gasEstimate,
          gasPrice: 1000000000,
          txGasToken: cardcpxdToken.address,
          refundReceiver: relayer,
        };
        let merchantSafeContract = await GnosisSafe.at(merchantSafe);
        let {
          executionResult: { gasFee },
        } = await signAndSendSafeTransaction(
          safeTxData,
          merchant,
          merchantSafeContract,
          relayer
        );
        let merchantSafeBalance = await getBalance(cardcpxdToken, merchantSafe);
        assert(
          merchantSafeBalance.eq(amountTokensAdded.sub(gasFee)),
          "reward safe balance is correct"
        );
        let rewardPoolBalance = await rewardPool.rewardBalance(
          rewardProgramID,
          cardcpxdToken.address
        );
        assert(
          rewardPoolBalance.eq(toTokenUnit(0)),
          "reward pool balance is correct"
        );
      });
    });
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await rewardPool.cardpayVersion()).to.equal("1.0.0");
      expect(await payRewardTokensHandler.cardpayVersion()).to.equal("1.0.0");
    });
  });
});
