const CumulativePaymentTree = require("./utils/cumulative-payment-tree");

const { assert, expect } = require("./setup");
const _ = require("lodash");

const ERC20Token = artifacts.require(
  "@openzeppelin/contract-upgradeable/contracts/token/ERC20/ERC20Mintable.sol"
);

const RewardPool = artifacts.require("RewardPool.sol");

const { ZERO_ADDRESS, getRewardSafeFromEventLog } = require("./utils/general");
const { setupProtocol, setupRoles } = require("./utils/setup");
const { randomHex } = require("web3-utils");
const {
  advanceBlock,
  toTokenUnit,
  getBalance,
  createDepotFromSupplierMgr,
  createPrepaidCardAndTransfer,
  registerRewardProgram,
  registerRewardee,
  claimReward,
} = require("./utils/helper");

const REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND = 500;
const REWARDEE_REGISTRATION_FEE_IN_SPEND = 500;

contract("RewardPool", function (accounts) {
  //main contracts
  let daicpxdToken, cardcpxdToken;

  let rewardManager, supplierManager, prepaidCardManager;

  let owner, issuer, prepaidCardOwner, relayer;

  let depot, rewardSafe;
  // reward roles
  let rewardProgramID, otherRewardProgramID;
  let tally;
  let rewardPool;
  let payments;
  describe("Reward Pool", function () {
    let prepaidCard;
    before(async () => {
      //accounts
      ({ owner, tally, issuer, prepaidCardOwner, relayer } = setupRoles(
        accounts
      ));

      // do not run this fixture inside a beforeEach
      // until we find a way to instantiate the objects that are only required
      ({
        prepaidCardManager,
        rewardManager,
        supplierManager,
        depot,
        //tokens
        daicpxdToken,
        cardcpxdToken,
      } = await setupProtocol(accounts));
    });
    beforeEach(async function () {
      //setting up reward pool
      rewardPool = await RewardPool.new();
      await rewardPool.initialize(owner);
      await rewardPool.setup(tally, rewardManager.address);
      //create depot
      depot = await createDepotFromSupplierMgr(supplierManager, issuer);
      await daicpxdToken.mint(depot.address, toTokenUnit(1000));
      //setting up prepaid cards
      rewardProgramID = randomHex(20);
      otherRewardProgramID = randomHex(20);
      prepaidCard = await createPrepaidCardAndTransfer(
        prepaidCardManager,
        relayer,
        depot,
        issuer,
        daicpxdToken,
        toTokenUnit(10 + 1), // must be enough to pay registration fees
        daicpxdToken,
        prepaidCardOwner,
        cardcpxdToken
      );

      // //register for rewards
      await registerRewardProgram(
        prepaidCardManager,
        prepaidCard,
        daicpxdToken,
        daicpxdToken,
        relayer,
        prepaidCardOwner, //reward program admin
        REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
        undefined,
        prepaidCardOwner, //current rewardProgramAdmin
        rewardProgramID
      );

      //setting up prepaid cards
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
          .setup(ZERO_ADDRESS, rewardManager.address)
          .should.be.rejectedWith(Error, "Tally should not be zero address");
      });

      it("reverts when reward manager is set to zero address", async () => {
        await rewardPool
          .setup(tally, ZERO_ADDRESS)
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
      it("starts a new payment cycle after the payee merkle root is submitted", async function () {
        let merkleTree = new CumulativePaymentTree(payments);
        let root = merkleTree.getHexRoot();
        let paymentCycleNumber = await rewardPool.numPaymentCycles();
        assert.equal(
          paymentCycleNumber.toNumber(),
          1,
          "the payment cycle number is correct"
        );

        let txn = await rewardPool.submitPayeeMerkleRoot(root, {
          from: tally,
        });
        let currentBlockNumber = await web3.eth.getBlockNumber();
        paymentCycleNumber = await rewardPool.numPaymentCycles();

        assert.equal(
          paymentCycleNumber.toNumber(),
          2,
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
          paymentCycleEvent.args.paymentCycle,
          1,
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
          3,
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
          2,
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
          .submitPayeeMerkleRoot(root, { from: owner }) // also doesn't allow owner to submit merkle root
          .should.be.rejectedWith(Error, "Caller is not tally");

        let paymentCycleNumber = await rewardPool.numPaymentCycles();

        assert.equal(
          paymentCycleNumber.toNumber(),
          1,
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
        await cardcpxdToken.mint(rewardPool.address, rewardPoolBalance);
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
        await cardcpxdToken.mint(rewardPool.address, rewardPoolBalance);
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
          toTokenUnit(10 + 1), // must be enough to pay registration fees
          daicpxdToken,
          payee,
          cardcpxdToken
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          rewardeePrepaidCard,
          daicpxdToken,
          daicpxdToken,
          relayer,
          payee,
          REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
        await claimReward(
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
          rewardProgramID,
          cardcpxdToken.address,
          payee
        );
        assert(
          rewardSafeBalance.eq(rewardSafePreviousBalance.add(paymentAmount)),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalance.sub(paymentAmount)),
          "the pool balance is correct"
        );
        assert(claims.eq(paymentAmount), "the claims amount is correct");
        assert.equal(Number(proofBalance), 0, "the proof balance is correct");
      });

      it("payee can make a claim less than their allotted amount from the pool", async function () {
        let claimAmount = toTokenUnit(8);
        assert(
          claimAmount.lt(paymentAmount),
          "claim amoount is less than payment"
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
          rewardProgramID,
          cardcpxdToken.address,
          payee
        );
        assert(
          claimAmount.eq(rewardSafeBalance.sub(rewardSafePreviousBalance)),
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

        await claimReward(
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

        await claimReward(
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
          rewardSafeBalance.eq(rewardSafePreviousBalance.add(claimAmount)),
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
          toTokenUnit(10 + 1), // must be enough to pay registration fees
          daicpxdToken,
          aPayee,
          cardcpxdToken
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          somePrepaidCard,
          daicpxdToken,
          daicpxdToken,
          relayer,
          aPayee,
          REWARDEE_REGISTRATION_FEE_IN_SPEND,
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
        let payeeIndex = 7; //the payment with 101
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
          toTokenUnit(10 + 1), // must be enough to pay registration fees
          daicpxdToken,
          rewardee,
          cardcpxdToken
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          somePrepaidCard,
          daicpxdToken,
          daicpxdToken,
          relayer,
          rewardee,
          REWARDEE_REGISTRATION_FEE_IN_SPEND,
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

      it("payee claim their allotted amount from an older proof", async function () {
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

        let claimAmount = toTokenUnit(8); //person should have total of 10(old proof)+12(new proof) to his name

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
          rewardProgramID,
          cardcpxdToken.address,
          payee
        );
        assert(
          rewardSafeBalance.eq(rewardSafePreviousBalance.add(claimAmount)),
          "the payee balance is correct"
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
        // TODO: Major bug. new proofs get deducted claims from previous proofs
        assert(
          updatedProofBalance.eq(updatedPaymentAmount.sub(claimAmount)),
          "the updated proof balance is correct"
        );
      });

      it("payee claim their allotted amount from a newer proof", async function () {
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

        await claimReward(
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
          rewardProgramID,
          cardcpxdToken.address,
          payee
        );

        assert(
          rewardSafeBalance.eq(rewardSafePreviousBalance.add(claimAmount)),
          "the payee balance is correct"
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
    });

    describe("multi-token support", () => {
      let rewardPoolBalance;
      let paymentCycle;
      let payee;
      let merkleTree;
      let root;
      let erc20Token;
      let rewardSafe, rewardeePrepaidCard;

      let rewardPoolPreviousBalanceCard,
        rewardPoolPreviousBalanceDai,
        rewardPoolPreviousBalanceErc20,
        rewardSafePreviousBalanceCard,
        rewardSafePreviousBalanceDai,
        rewardSafePreviousBalanceErc20;

      beforeEach(async function () {
        payee = accounts[11];
        erc20Token = await ERC20Token.new();
        await erc20Token.initialize(owner);
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
          {
            rewardProgramID,
            payee,
            token: erc20Token.address,
            amount: toTokenUnit(10),
          },
        ];

        rewardPoolBalance = toTokenUnit(500);
        await cardcpxdToken.mint(rewardPool.address, rewardPoolBalance);
        await daicpxdToken.mint(rewardPool.address, rewardPoolBalance);
        await erc20Token.mint(rewardPool.address, rewardPoolBalance);

        merkleTree = new CumulativePaymentTree(payments);
        root = merkleTree.getHexRoot();

        paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });

        //registering rewardee
        rewardeePrepaidCard = await createPrepaidCardAndTransfer(
          prepaidCardManager,
          relayer,
          depot,
          issuer,
          daicpxdToken,
          toTokenUnit(10 + 1), // must be enough to pay registration fees
          daicpxdToken,
          payee,
          cardcpxdToken
        );
        const tx = await registerRewardee(
          prepaidCardManager,
          rewardeePrepaidCard,
          daicpxdToken,
          daicpxdToken,
          relayer,
          payee,
          REWARDEE_REGISTRATION_FEE_IN_SPEND,
          undefined,
          rewardProgramID
        );
        rewardSafe = await getRewardSafeFromEventLog(tx, rewardManager.address);

        //get balance
        rewardPoolPreviousBalanceCard = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );
        rewardPoolPreviousBalanceDai = await getBalance(
          daicpxdToken,
          rewardPool.address
        );
        rewardPoolPreviousBalanceErc20 = await getBalance(
          erc20Token,
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
        rewardSafePreviousBalanceErc20 = await getBalance(
          erc20Token,
          rewardSafe.address
        );
      });

      it("can claim erc20 tokens", async () => {
        const erc20Amount = toTokenUnit(5);
        const erc20Proof = merkleTree.hexProofForPayee(
          rewardProgramID,
          payee,
          erc20Token.address,
          paymentCycle
        );
        await claimReward(
          rewardManager,
          rewardPool,
          relayer,
          rewardSafe,
          payee,
          rewardProgramID,
          erc20Token,
          erc20Amount,
          erc20Proof
        );
        const proofBalance = await rewardPool.balanceForProofWithAddress(
          rewardProgramID,
          erc20Token.address,
          payee,
          erc20Proof
        );
        const rewardSafeBalance = await getBalance(
          erc20Token,
          rewardSafe.address
        );
        let rewardPoolBalance = await getBalance(
          erc20Token,
          rewardPool.address
        );

        assert(
          rewardSafeBalance.eq(rewardSafePreviousBalanceErc20.add(erc20Amount)),
          "the reward safe balance is correct"
        );
        assert(
          rewardPoolBalance.eq(rewardPoolPreviousBalanceErc20.sub(erc20Amount)),
          "the pool balance is correct"
        );

        assert(
          proofBalance.eq(toTokenUnit(10).sub(erc20Amount)),
          "the proof balance is correct"
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

        await claimReward(
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

        await claimReward(
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
            rewardSafePreviousBalanceCard.add(cardAmount)
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
          rewardSafeBalanceDai.eq(rewardSafePreviousBalanceDai.add(daiAmount)),
          "the reward safe balance is correct"
        );

        assert(
          rewardPoolBalanceDai.eq(rewardPoolPreviousBalanceDai.sub(daiAmount)),
          "the pool balance is correct"
        );
      });

      //TODO
      it("can claim nft tokens", async () => {});
    });
  });
});
