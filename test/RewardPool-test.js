const CumulativePaymentTree = require("./utils/cumulative-payment-tree");

const { assert, expect, TOKEN_DETAIL_DATA } = require("./setup");
const _ = require("lodash");

const ERC677Token = artifacts.require("ERC677Token.sol");

const RewardPool = artifacts.require("RewardPool.sol");
const GnosisSafe = artifacts.require("GnosisSafe");

const {
  ZERO_ADDRESS,
  getRewardSafeFromEventLog,
  checkGnosisExecution,
  getParamsFromEvent,
} = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");
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
  recoverUnclaimedRewardTokens,
  registerMerchant,
  signAndSendSafeTransaction,
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

      payments = [
        {
          rewardProgramID: rewardProgramID,
          payee: accounts[11],
          token: cardcpxdToken.address,
          amount: toTokenUnit(10),
        },
        {
          rewardProgramID: rewardProgramID,
          payee: accounts[12],
          token: cardcpxdToken.address,
          amount: toTokenUnit(12),
        },
        {
          rewardProgramID: rewardProgramID,
          payee: accounts[13],
          token: cardcpxdToken.address,
          amount: toTokenUnit(2),
        },
        {
          rewardProgramID: rewardProgramID,
          payee: accounts[14],
          token: cardcpxdToken.address,
          amount: toTokenUnit(1),
        },
        {
          rewardProgramID: rewardProgramID,
          payee: accounts[15],
          token: cardcpxdToken.address,
          amount: toTokenUnit(32),
        },
        {
          rewardProgramID: otherRewardProgramID,
          payee: accounts[16],
          token: cardcpxdToken.address,
          amount: toTokenUnit(10),
        },
        {
          rewardProgramID: otherRewardProgramID,
          payee: accounts[17],
          token: cardcpxdToken.address,
          amount: toTokenUnit(9),
        },
        {
          rewardProgramID: rewardProgramID,
          payee: accounts[18],
          token: cardcpxdToken.address,
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

    describe("claim", function () {
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
        proof = merkleTree.hexProofForPayee(
          rewardProgramID,
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
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

      it("payee can claim up to their allotted amount from pool", async function () {
        const {
          executionResult: { gasFee },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          paymentAmount,
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
        let proofBalance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          proof,
          { from: payee }
        );

        let claims = await rewardPool.claims(
          paymentCycle,
          rewardProgramID,
          cardcpxdToken.address,
          payee
        );
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
        assert(claims.eq(paymentAmount), "the claims amount is correct");
        assert.equal(Number(proofBalance), 0, "the proof balance is correct");
      });

      it("payee cannot claim using an eoa", async function () {
        await rewardPool
          .claim(rewardProgramID, cardcpxdToken.address, paymentAmount, proof, {
            from: payee,
          })
          .should.be.rejectedWith(
            Error,
            "Transaction reverted: function call to a non-contract account"
          );
      });
      it("payee cannot claim from a safe associated with different reward program", async function () {
        let aPayee = payments[4].payee;
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
          rewardProgramID,
          cardcpxdToken,
          paymentAmount,
          proof
        ).should.be.rejectedWith(
          Error,
          "can only withdraw for safe registered on reward program"
        );
      });
      it("payee can make a claim less than their allotted amount from the pool", async function () {
        let claimAmount = toTokenUnit(8);
        assert(
          claimAmount.lt(paymentAmount),
          "claim amount is less than payment"
        );
        const {
          executionResult: { gasFee },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
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
        let proofBalance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          proof,
          { from: payee }
        );

        let claims = await rewardPool.claims(
          paymentCycle,
          rewardProgramID,
          cardcpxdToken.address,
          payee
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
        assert(claims.eq(claimAmount), "the claims amount is correct");
        assert(
          proofBalance.eq(paymentAmount.sub(claimAmount)),
          "the proof balance is correct"
        );
      });

      it("payee can make mulitple claims within their allotted amount from the pool", async function () {
        let claimAmount = toTokenUnit(4).add(toTokenUnit(6));

        const {
          executionResult: { gasFee: gasFeeFirstClaim },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          toTokenUnit(4),
          proof
        );

        const {
          executionResult: { gasFee: gasFeeSecondClaim },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          toTokenUnit(6),
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
        let claims = await rewardPool.claims(
          paymentCycle,
          rewardProgramID,
          cardcpxdToken.address,
          payee
        );
        let proofBalance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert(
          rewardSafeBalance.eq(
            rewardSafePreviousBalance
              .add(claimAmount)
              .sub(gasFeeFirstClaim)
              .sub(gasFeeSecondClaim)
          ),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalance.sub(claimAmount)),
          "the pool balance is correct"
        );
        assert(claims.eq(claimAmount), "the claims amount is correct");
        assert(
          proofBalance.eq(paymentAmount.sub(claimAmount)),
          "the proof balance is correct"
        );
      });

      it("payee cannot claim more than their allotted amount from the pool", async function () {
        let claimAmount = toTokenUnit(11);
        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
          proof
        ).should.be.rejectedWith(Error, "Insufficient balance for proof");
      });

      it("payee cannot claim using a proof whose metadata has been tampered with", async function () {
        let claimAmount = toTokenUnit(10);
        // the cumulative amount in in the proof's meta has been increased artifically to 12 tokens: note the "c" in the 127th position of the proof, here ---v
        let tamperedProof =
          "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000c2e46ed0464b1e11097030a04086c9f068606b4c9808ccdac0343863c5e4f8244749e106fa8d91408f2578e5d93447f727f59279be85ce491faf212a7201d3b836b94214bff74426647e9cf0b5c5c3cbc9cef25b7e08759ca2b85357ec22c9b40";

        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
          tamperedProof
        ).should.be.rejectedWith(Error, "Insufficient balance for proof");

        let tamperedProofBalance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          tamperedProof,
          { from: payee }
        );
        assert.equal(
          tamperedProofBalance,
          0,
          "the tampered proof balance is 0 tokens"
        );
      });

      it("payee cannot make mulitple claim that total to more than their allotted amount from the pool", async function () {
        let claimAmount = toTokenUnit(4);
        let secondClaimAmount = toTokenUnit(7);
        assert(
          secondClaimAmount.add(claimAmount).gt(paymentAmount),
          "total claim amoount exceeds paymentAmount"
        );
        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
          proof
        );

        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          secondClaimAmount,
          proof
        ).should.be.rejectedWith(Error, "Insufficient balance for proof");
      });

      it("payee cannot claim 0 tokens from payment pool", async function () {
        let claimAmount = toTokenUnit(0);
        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
          proof
        ).should.be.rejectedWith(Error, "Cannot claim non-positive amount");
      });

      it("non-payee cannot claim from pool", async function () {
        let claimAmount = toTokenUnit(10);
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
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
          proof //this is the wrong proof
        ).should.be.rejectedWith(Error, "Insufficient balance for proof");
      });

      it("payee cannot claim their allotted tokens from the pool when the pool does not have enough tokens", async function () {
        let payeeIndex = 7;
        let rewardee = payments[payeeIndex].payee;
        let paymentAmountAbove100 = payments[payeeIndex].amount;
        let proof = merkleTree.hexProofForPayee(
          rewardProgramID,
          rewardee,
          cardcpxdToken.address,
          paymentCycle
        );

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
          rewardProgramID,
          cardcpxdToken,
          paymentAmountAbove100,
          proof
        ).should.be.rejectedWith(Error, "Reward pool has insufficient balance");
      });

      it("payee cannot claim their allotted tokens from the pool when the reward program does not have enough tokens in the pool", async function () {
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
        let proof = merkleTree.hexProofForPayee(
          otherRewardProgramID,
          rewardee,
          cardcpxdToken.address,
          paymentCycle
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
          otherRewardProgramID,
          cardcpxdToken,
          paymentAmount,
          proof
        ).should.be.rejectedWith(
          Error,
          "Reward program has insufficient balance inside reward pool"
        );
      });
      it("payee can claim their allotted amount from an older proof", async function () {
        let updatedPayments = payments.slice();
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
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

        let claimAmount = toTokenUnit(8);

        const {
          executionResult: { gasFee },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
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
        let proofBalance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          proof,
          { from: payee }
        );
        let updatedProofBalance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );
        let claims = await rewardPool.claims(
          paymentCycle - 1,
          rewardProgramID,
          cardcpxdToken.address,
          payee
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
        assert(claims.eq(claimAmount), "the claims amount is correct");
        assert(
          proofBalance.eq(paymentAmount.sub(claimAmount)),
          "the proof balance is correct"
        );
        assert(
          updatedProofBalance.eq(updatedPaymentAmount),
          "the updated proof balance is correct"
        );
      });

      it("payee can claim their allotted amount from a newer proof", async function () {
        let updatedPayments = payments.slice();
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
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

        let claimAmount = toTokenUnit(8);

        const {
          executionResult: { gasFee },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
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
        let updatedProofBalance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );
        let claims = await rewardPool.claims(
          paymentCycle,
          rewardProgramID,
          cardcpxdToken.address,
          payee
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
        assert(claims.eq(claimAmount), "the claims amount is correct");
        assert(
          updatedProofBalance.eq(updatedPaymentAmount.sub(claimAmount)),
          "the updated proof balance is correct"
        );
      });

      it("payee can claim their allotted amount from a newer proof even after claim from older proof", async function () {
        let updatedPayments = payments.slice();
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
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

        let claimAmount = toTokenUnit(8);

        const {
          executionResult: { gasFee: gasFeeClaimFromOlderProof },
        } = await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
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
              .add(claimAmount)
              .sub(gasFeeClaimFromOlderProof)
          ),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalance.sub(claimAmount)),
          "the pool balance is correct"
        );
        let olderProofBalance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          proof,
          { from: payee }
        );
        let newerProofBalance = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );
        assert(
          olderProofBalance.eq(paymentAmount.sub(claimAmount)),
          "the older proof balance is correct"
        );
        assert(
          newerProofBalance.eq(updatedPaymentAmount),
          "the newer proof balance is correct"
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
          rewardProgramID,
          cardcpxdToken,
          claimAmount,
          updatedProof
        );
        rewardSafeBalance = await getBalance(cardcpxdToken, rewardSafe.address);
        rewardPoolBalance = await getBalance(cardcpxdToken, rewardPool.address);
        let newerProofBalanceAfterClaim = await rewardPool.balanceForProof(
          rewardProgramID,
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );
        assert(
          rewardSafeBalance.eq(
            rewardSafePreviousBalance
              .add(claimAmount)
              .add(claimAmount)
              .sub(gasFeeClaimFromOlderProof)
              .sub(gasFeeClaimFromNewerProof)
          ),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(
            rewardPoolPreviousBalance.sub(claimAmount).sub(claimAmount)
          ),
          "the pool balance is correct"
        );
        assert(
          newerProofBalanceAfterClaim.eq(updatedPaymentAmount.sub(claimAmount)),
          "the newer proof balance is correct"
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
        await payRewardTokensHandler.setup(
          actionDispatcher.address,
          tokenManager.address,
          rewardPool.address,
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
          refundReceive: relayer,
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
