const CumulativePaymentTree = require("./utils/cumulative-payment-tree");

const { assert, expect, TOKEN_DETAIL_DATA } = require("./setup");
const _ = require("lodash");

const ERC677Token = artifacts.require("ERC677Token.sol");

const RewardPool = artifacts.require("RewardPool.sol");

const {
  ZERO_ADDRESS,
  getRewardSafeFromEventLog,
  checkGnosisExecution,
} = require("./utils/general");
const { setupProtocol, setupRoles } = require("./utils/setup");
const { randomHex, BN } = require("web3-utils");
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
    proxyFactory;

  let owner, issuer, prepaidCardOwner, relayer, governanceAdmin;

  let depot, rewardSafe;
  let rewardProgramID, otherRewardProgramID;
  let tally;
  let rewardPool;
  let payments;
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
      await rewardManager.setup(
        actionDispatcher.address,
        gnosisSafeMasterCopy.address,
        proxyFactory.address,
        rewardFeeReceiver,
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        [rewardPool.address],
        governanceAdmin,
        versionManager.address
      );
      rewardProgramID = randomHex(20);
      otherRewardProgramID = randomHex(20);
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
          startBlock: currentBlockNumber,
          endBlock: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[11],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(10),
        },
        {
          paymentCycleNumber: 1,
          startBlock: currentBlockNumber,
          endBlock: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[12],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(12),
        },
        {
          paymentCycleNumber: 1,
          startBlock: currentBlockNumber,
          endBlock: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[13],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(2),
        },
        {
          paymentCycleNumber: 1,
          startBlock: currentBlockNumber,
          endBlock: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[14],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(1),
        },
        {
          paymentCycleNumber: 1,
          startBlock: currentBlockNumber,
          endBlock: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[15],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(32),
        },
        {
          paymentCycleNumber: 1,
          startBlock: currentBlockNumber,
          endBlock: currentBlockNumber + 10000,
          rewardProgramID: otherRewardProgramID,
          payee: accounts[16],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(10),
        },
        {
          paymentCycleNumber: 1,
          startBlock: currentBlockNumber,
          endBlock: currentBlockNumber + 10000,
          rewardProgramID: otherRewardProgramID,
          payee: accounts[17],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(9),
        },
        {
          paymentCycleNumber: 1,
          startBlock: currentBlockNumber,
          endBlock: currentBlockNumber + 10000,
          rewardProgramID: rewardProgramID,
          payee: accounts[18],
          token: cardcpxdToken.address,
          tokenType: 1,
          amount: toTokenUnit(101), // this amount is used to test logic when the payment pool doesn't have sufficient funds
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
      let previousPaymentCycleNumber;
      beforeEach(async function () {
        previousPaymentCycleNumber = await rewardPool.numPaymentCycles();
      });
      it("starts a new payment cycle after the payee merkle root is submitted", async function () {
        let merkleTree = new CumulativePaymentTree(payments);
        let root = merkleTree.getHexRoot();
        let paymentCycleNumber = await rewardPool.numPaymentCycles();
        assert.equal(
          paymentCycleNumber.toNumber(),
          previousPaymentCycleNumber.toNumber(),
          "the payment cycle number is correct"
        );

        let txn = await rewardPool.submitPayeeMerkleRoot(root, {
          from: tally,
        });
        let currentBlockNumber = await web3.eth.getBlockNumber();
        paymentCycleNumber = await rewardPool.numPaymentCycles();
        assert.equal(
          paymentCycleNumber.toNumber(),
          previousPaymentCycleNumber.add(new BN(1)).toNumber(),
          "the payment cycle number is correct"
        );
        assert.equal(
          txn.logs.length,
          2,
          "the correct number of events were fired"
        );

        const eventsFired = txn.logs.map(({ event }) => event);
        const paymentCycleEvent = _.find(txn.logs, {
          event: "PaymentCycleEnded",
        });

        assert(
          _.isEqual(
            _.sortBy(eventsFired),
            _.sortBy(["PaymentCycleEnded", "MerkleRootSubmission"])
          )
        );
        assert.equal(
          paymentCycleEvent.args.paymentCycle.toNumber(),
          previousPaymentCycleNumber.toNumber(),
          "the payment cycle number is correct"
        );

        assert.equal(
          Number(paymentCycleEvent.args.startBlock),
          0,
          "the payment cycle start block is correct"
        );
        assert.equal(
          Number(paymentCycleEvent.args.endBlock),
          currentBlockNumber,
          "the payment cycle end block is correct"
        );
      });

      it("allows a new merkle root to be submitted in a block after the previous payment cycle has ended", async function () {
        let merkleTree = new CumulativePaymentTree(payments);
        let root = merkleTree.getHexRoot();
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });

        let updatedPayments = payments.slice();
        updatedPayments[0].amount = updatedPayments[0].amount.add(
          toTokenUnit(10)
        );
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        await rewardPool.submitPayeeMerkleRoot(updatedRoot, {
          from: tally,
        });

        let paymentCycleNumber = await rewardPool.numPaymentCycles();

        assert.equal(
          paymentCycleNumber.toNumber(),
          previousPaymentCycleNumber.add(new BN(2)).toNumber(),
          "the payment cycle number is correct"
        );
      });

      it("does not allow 2 merkle roots to be submitted in the same block after the previous payment cycle has ended", async function () {
        let merkleTree = new CumulativePaymentTree(payments);
        let root = merkleTree.getHexRoot();
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });

        let updatedPayments = payments.slice();
        updatedPayments[0].amount = updatedPayments[0].amount.add(
          toTokenUnit(10)
        );
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await rewardPool
          .submitPayeeMerkleRoot(updatedRoot, { from: tally })
          .should.be.rejectedWith(
            Error,
            "Cannot start new payment cycle before currentPaymentCycleStartBlock"
          );
        let paymentCycleNumber = await rewardPool.numPaymentCycles();

        assert.equal(
          paymentCycleNumber.toNumber(),
          previousPaymentCycleNumber.add(new BN(1)).toNumber(),
          "the payment cycle number is correct"
        );
      });

      it("does not allow non-tally to submit merkle root", async function () {
        let merkleTree = new CumulativePaymentTree(payments);
        let root = merkleTree.getHexRoot();

        await rewardPool
          .submitPayeeMerkleRoot(root, { from: accounts[11] })
          .should.be.rejectedWith(Error, "Caller is not tally");

        await rewardPool
          .submitPayeeMerkleRoot(root, { from: owner })
          .should.be.rejectedWith(Error, "Caller is not tally");

        let paymentCycleNumber = await rewardPool.numPaymentCycles();

        assert.equal(
          paymentCycleNumber.toNumber(),
          previousPaymentCycleNumber.toNumber(),
          "the payment cycle number is correct"
        );
      });
    });

    describe("balanceForProof", function () {
      let rewardPoolBalance;
      let paymentCycle;
      let payeeIndex = 0;
      let payee;
      let paymentAmount;
      let merkleTree;
      let root;
      let proof;

      beforeEach(async function () {
        payee = payments[payeeIndex].payee;
        rewardPoolBalance = toTokenUnit(100);
        paymentAmount = payments[payeeIndex].amount;
        await mintWalletAndRefillPool(
          cardcpxdToken,
          rewardPool,
          prepaidCardOwner,
          rewardPoolBalance,
          rewardProgramID
        );
        paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        merkleTree = new CumulativePaymentTree(payments);
        proof = merkleTree.hexProofForPayee(
          rewardProgramID,
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        root = merkleTree.getHexRoot();
        rewardPool.submitPayeeMerkleRoot.estimateGas(root, { from: tally }).then(
          function(gas) {
            console.log(gas);
          }
        )
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });
      });

      it("payee can get their available balance in the payment pool from their proof", async function () {
        let balance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          proof,
          { from: payee }
        );
        assert(balance.eq(paymentAmount), "the balance is correct");
      });

      it("non-payee can get the available balance in the payment pool for an address and proof", async function () {
        let balance = await rewardPool.balanceForProofWithAddress(
          rewardProgramID,
          cardcpxdToken.address,
          payee,
          proof
        );
        assert(balance.eq(paymentAmount), "the balance is correct");
      });

      it("an invalid proof/address pair returns a balance of 0 in the payment pool", async function () {
        let differentPayee = payments[4].payee;
        let differentUsersProof = merkleTree.hexProofForPayee(
          rewardProgramID,
          differentPayee,
          cardcpxdToken.address,
          paymentCycle
        );
        let balance = await rewardPool.balanceForProofWithAddress(
          rewardProgramID,
          cardcpxdToken.address,
          payee,
          differentUsersProof
        );
        assert.equal(Number(balance), 0, "the balance is correct");
      });

      it("garbage proof data returns a balance of 0 in payment pool", async function () {
        const randomProof = web3.utils.randomHex(32 * 5);
        let balance = await rewardPool.balanceForProofWithAddress(
          rewardProgramID,
          cardcpxdToken.address,
          payee,
          randomProof
        );
        assert.equal(Number(balance), 0, "the balance is correct");
      });

      it("proof that is not the correct size returns revert", async function () {
        const randomProof = web3.utils.randomHex(31 * 5);
        await rewardPool
          .balanceForProofWithAddress(
            rewardProgramID,
            cardcpxdToken.address,
            payee,
            randomProof
          )
          .should.be.rejectedWith(Error, "Bytearray provided has wrong shape");
      });

      it("proof that is too big returns revert", async function () {
        const randomProof = web3.utils.randomHex(51 * 32);
        await rewardPool
          .balanceForProofWithAddress(
            rewardProgramID,
            cardcpxdToken.address,
            payee,
            randomProof
          )
          .should.be.rejectedWith(Error, "Bytearray provided is too big");
      });

      it("can handle balance for proofs from different payment cycles", async function () {
        let updatedPayments = payments.slice();
        let updatedPaymentAmount = toTokenUnit(20);
        updatedPayments[payeeIndex].amount = updatedPaymentAmount;
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        let updatedProof = updatedMerkleTree.hexProofForPayee(
          rewardProgramID,
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let balance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          updatedProof,
          {
            from: payee,
          }
        );
        assert(
          balance.eq(updatedPaymentAmount),
          "the balance is correct for the updated proof"
        );

        balance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );
        assert(
          balance.eq(paymentAmount),
          "the balance is correct for the original proof"
        );
      });

      it("balance of payee that has 0 tokens in payment list returns 0 balance in payment pool", async function () {
        let aPayee = accounts[1];
        let updatedPayments = payments.slice();
        updatedPayments.push({
          rewardProgramID,
          payee: aPayee,
          token: cardcpxdToken.address,
          amount: toTokenUnit(0),
        });
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        let updatedProof = updatedMerkleTree.hexProofForPayee(
          rewardProgramID,
          aPayee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let balance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          updatedProof,
          {
            from: aPayee,
          }
        );
        assert.equal(
          Number(balance),
          0,
          "the balance is correct for the updated proof"
        );
      });

      it("balance of proof for payee that has mulitple entries in the payment list returns the sum of all their amounts in the payment pool", async function () {
        let updatedPayments = payments.slice();
        updatedPayments.push({
          rewardProgramID,
          payee,
          token: cardcpxdToken.address,
          amount: toTokenUnit(8),
        });
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        let updatedProof = updatedMerkleTree.hexProofForPayee(
          rewardProgramID,
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let balance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          updatedProof,
          {
            from: payee,
          }
        );
        assert.equal(
          Number(balance),
          toTokenUnit(18),
          "the balance is correct for the updated proof"
        );
      });
    });

    describe.only("claim", function () {
      let rewardPoolBalance;
      let paymentCycle;
      let proof;
      let payeeIndex = 0;
      let payee;
      let paymentAmount;
      let merkleTree;
      let root;
      let rewardeePrepaidCard;
      let rewardSafePreviousBalance, rewardPoolPreviousBalance;

      beforeEach(async function () {
        payee = payments[payeeIndex].payee;
        paymentAmount = payments[payeeIndex].amount;
        merkleTree = new CumulativePaymentTree(payments);
        root = merkleTree.getHexRoot();
        rewardPoolBalance = toTokenUnit(100);
        await mintWalletAndRefillPool(
          cardcpxdToken,
          rewardPool,
          prepaidCardOwner,
          rewardPoolBalance,
          rewardProgramID
        );
        paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        leaf = merkleTree.getLeaf(payments[payeeIndex]);
        proof = merkleTree.getProof(payments[payeeIndex]);
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });
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

      it("payee can claim from the pool", async function () {
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
        let hasClaimed = await rewardPool.claimed(
          leaf,
          { from: payee }
        );
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
      });

      it("payee cannot claim using an eoa", async function () {
        await rewardPool
          .claim(leaf, proof, false, {
            from: payee,
          })
          .should.be.rejectedWith(
            Error,
            "Transaction reverted: function call to a non-contract account"
          );
      });
      it("payee cannot claim from a safe associated with different reward program", async function () {
        let aPayee = payments[0].payee;
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

      it("payee cannot claim their allotted tokens from the pool when the pool does not have enough tokens", async function () {
        let payeeIndex = 7;
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

      it("payee cannot claim their allotted tokens from the pool when the reward program does not have enough tokens in the pool and don't want to allow partial claims", async function () {
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
        let payeeIndex = 6;
        let rewardee = payments[payeeIndex].payee;
        let paymentAmount = payments[payeeIndex].amount;
        let proof = merkleTree.getProof(payments[payeeIndex]);
        let leaf = merkleTree.getLeaf(payments[payeeIndex]);

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

      it("payee can claim the remaining tokens from a pool when the reward program does not have enough tokens in the pool and the user does want to allow partial claims", async function () {
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
        let payeeIndex = 6;
        let rewardee = payments[payeeIndex].payee;
        let paymentAmount = payments[payeeIndex].amount;
        let proof = merkleTree.getProof(payments[payeeIndex]);
        let leaf = merkleTree.getLeaf(payments[payeeIndex]);

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
          proof,
          true
        ).should.not.be.rejectedWith(
          Error,
          "Reward program has insufficient balance inside reward pool"
        );
      });

      it("payee cannot claim their allotted tokens from the pool even when they allow partial claims if the reward program is empty", async function () {
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
        let payeeIndex = 6;
        let rewardee = payments[payeeIndex].payee;
        let paymentAmount = payments[payeeIndex].amount;
        let proof = merkleTree.getProof(payments[payeeIndex]);
        let leaf = merkleTree.getLeaf(payments[payeeIndex]);

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
        ).should.be.rejectedWith(
          Error,
          "Reward program has insufficient balance inside reward pool"
        );
      });

      it("payee can claim their allotted amount from an older proof", async function () {
        let updatedPayments = [];
        for (var i = 0; i < payments.length; i++) {
          let payment = Object.assign({}, payments[i]);
          payment['paymentCycleNumber'] += 1;
          updatedPayments.push(payment);
        }
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        let updatedProof = updatedMerkleTree.getProof(updatedPayments[payeeIndex]);
        let updatedLeaf = updatedMerkleTree.getLeaf(updatedPayments[payeeIndex]);

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

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
        
        let claimed = await rewardPool.claimed(
          leaf, proof
        );

        let updatedClaimed = await rewardPool.claimed(
          updatedLeaf, updatedProof
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

      it("payee can claim their allotted amount from a newer proof", async function () {
        let updatedPayments = [];
        for (var i = 0; i < payments.length; i++) {
          let payment = Object.assign({}, payments[i]);
          payment['paymentCycleNumber'] += 1;
          updatedPayments.push(payment);
        }
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        let updatedProof = updatedMerkleTree.getProof(updatedPayments[payeeIndex]);
        let updatedLeaf = updatedMerkleTree.getLeaf(updatedPayments[payeeIndex]);
   
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

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

        let claimed = await rewardPool.claimed(
          leaf, proof
        );

        let updatedClaimed = await rewardPool.claimed(
          updatedLeaf, updatedProof
        );

        assert(
          rewardSafeBalance.eq(
            rewardSafePreviousBalance.add(updatedPaymentAmount).sub(gasFee)
          ),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalance.sub(updatedPaymentAmount)),
          "the pool balance is correct"
        );
        assert(!claimed, "the original proof has not been claimed");
        assert(updatedClaimed, "the new proof has been claimed");
      });

      it("payee can claim their allotted amount from a newer proof even after claim from older proof", async function () {
        let updatedPayments = [];
        for (var i = 0; i < payments.length; i++) {
          let payment = Object.assign({}, payments[i]);
          payment['paymentCycleNumber'] += 1;
          updatedPayments.push(payment);
        }
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        
        let updatedProof = updatedMerkleTree.getProof(updatedPayments[payeeIndex]);
        let updatedLeaf = updatedMerkleTree.getLeaf(updatedPayments[payeeIndex]);

        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

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
            rewardPoolPreviousBalance.sub(paymentAmount).sub(updatedPaymentAmount)
          ),
          "the pool balance is correct"
        );
      });
    });

    describe("multi-token support", () => {
      let rewardPoolBalance;
      let paymentCycle;
      let payee;
      let merkleTree;
      let root;
      let rewardSafe, rewardeePrepaidCard;

      let rewardPoolPreviousBalanceCard,
        rewardPoolPreviousBalanceDai,
        rewardSafePreviousBalanceCard,
        rewardSafePreviousBalanceDai;

      beforeEach(async function () {
        payee = accounts[11];
        payments = [
          {
            rewardProgramID,
            payee,
            token: daicpxdToken.address,
            amount: toTokenUnit(10),
          },
          {
            rewardProgramID,
            payee,
            token: daicpxdToken.address,
            amount: toTokenUnit(12),
          },
          {
            rewardProgramID,
            payee,
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

        merkleTree = new CumulativePaymentTree(payments);
        root = merkleTree.getHexRoot();

        paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });

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
        const daiAmount = toTokenUnit(10).add(toTokenUnit(12));
        const cardProof = merkleTree.hexProofForPayee(
          rewardProgramID,
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        const daiProof = merkleTree.hexProofForPayee(
          rewardProgramID,
          payee,
          daicpxdToken.address,
          paymentCycle
        );

        const {
          executionResult: { gasFee: gasFeeCardClaim },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          cardAmount,
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
          rewardProgramID,
          daicpxdToken,
          daiAmount,
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
            AbiCoder.encodeParameters(["address"], [randomHex(20)]),
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
        ({
          prepaidCardManager,
          rewardManager,
          depot,
          daicpxdToken,
          cardcpxdToken,
          tokenManager,
          rewardPool,
        } = await setupProtocol(accounts));
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
        const prepaidCardPreviousBalanceDai = await getBalance(
          daicpxdToken,
          prepaidCard.address
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
        let txn = await payRewardTokens(
          prepaidCardManager,
          prepaidCard,
          relayer,
          prepaidCardOwner,
          500,
          undefined,
          rewardProgramID
        );
        const { gasFee, success } = checkGnosisExecution(
          txn,
          prepaidCard.address
        );
        assert(success, "gnosis execution succesfull");
        const rewardPoolBalanceDai = await getBalance(
          daicpxdToken,
          rewardPool.address
        );

        const rewardPoolBalanceCardByRewardProgram =
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
          rewardPoolBalanceCardByRewardProgram.eq(
            new BN("5000000000000000000")
          ),
          "the reward pool balance is correct"
        );
        assert(
          prepaidCardPreviousBalanceDai
            .sub(new BN("5000000000000000000"))
            .sub(new BN("5000000000000000000"))
            .sub(gasFee)
            .eq(prepaidCardBalanceDai),
          "the prepaid card token balance is correct"
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
