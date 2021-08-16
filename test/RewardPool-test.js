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
  let rewardProgramID;
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
          payee: accounts[11],
          token: cardcpxdToken.address,
          amount: toTokenUnit(10),
        },
        {
          payee: accounts[12],
          token: cardcpxdToken.address,
          amount: toTokenUnit(12),
        },
        {
          payee: accounts[13],
          token: cardcpxdToken.address,
          amount: toTokenUnit(2),
        },
        {
          payee: accounts[14],
          token: cardcpxdToken.address,
          amount: toTokenUnit(1),
        },
        {
          payee: accounts[15],
          token: cardcpxdToken.address,
          amount: toTokenUnit(32),
        },
        {
          payee: accounts[16],
          token: cardcpxdToken.address,
          amount: toTokenUnit(10),
        },
        {
          payee: accounts[17],
          token: cardcpxdToken.address,
          amount: toTokenUnit(9),
        },
        {
          payee: accounts[18],
          token: cardcpxdToken.address,
          amount: toTokenUnit(101), // this amount is used to test logic when the payment pool doesn't have sufficient funds
        },
      ];
    });

    afterEach(async function () {
      payments[0].amount = toTokenUnit(10); //one of the tests is bleeding state...
      let balance = await cardcpxdToken.balanceOf(accounts[11]);
      console.log("balancebefore", balance.toString());
      await cardcpxdToken.burn(balance, { from: accounts[11] });
      let balanceAfter = await cardcpxdToken.balanceOf(accounts[11]);
      console.log("balanceafter", balanceAfter.toString());
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
      let rewardeePrepaidCard;

      beforeEach(async function () {
        payee = payments[payeeIndex].payee;
        rewardPoolBalance = toTokenUnit(100);
        paymentAmount = payments[payeeIndex].amount;
        await cardcpxdToken.mint(rewardPool.address, rewardPoolBalance);
        paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        merkleTree = new CumulativePaymentTree(payments);
        proof = merkleTree.hexProofForPayee(
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        root = merkleTree.getHexRoot();
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });
      });

      it("payee can get their available balance in the payment pool from their proof", async function () {
        let balance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          { from: payee }
        );
        assert(balance.eq(paymentAmount), "the balance is correct");
      });

      it("non-payee can get the available balance in the payment pool for an address and proof", async function () {
        let balance = await rewardPool.balanceForProofWithAddress(
          cardcpxdToken.address,
          payee,
          proof
        );
        assert(balance.eq(paymentAmount), "the balance is correct");
      });

      it("an invalid proof/address pair returns a balance of 0 in the payment pool", async function () {
        let differentPayee = payments[4].payee;
        let differentUsersProof = merkleTree.hexProofForPayee(
          differentPayee,
          cardcpxdToken.address,
          paymentCycle
        );
        let balance = await rewardPool.balanceForProofWithAddress(
          cardcpxdToken.address,
          payee,
          differentUsersProof
        );
        assert.equal(Number(balance), 0, "the balance is correct");
      });

      it("garbage proof data returns a balance of 0 in payment pool", async function () {
        const randomProof = web3.utils.randomHex(32 * 5);
        let balance = await rewardPool.balanceForProofWithAddress(
          cardcpxdToken.address,
          payee,
          randomProof
        );
        assert.equal(Number(balance), 0, "the balance is correct");
      });

      it("proof that is not the correct size returns revert", async function () {
        const randomProof = web3.utils.randomHex(31 * 5);
        await rewardPool
          .balanceForProofWithAddress(cardcpxdToken.address, payee, randomProof)
          .should.be.rejectedWith(Error, "Bytearray provided has wrong shape");
      });

      it("proof that is too big returns revert", async function () {
        const randomProof = web3.utils.randomHex(51 * 32);
        await rewardPool
          .balanceForProofWithAddress(cardcpxdToken.address, payee, randomProof)
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
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let balance = await rewardPool.balanceForProof(
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
          aPayee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let balance = await rewardPool.balanceForProof(
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
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let balance = await rewardPool.balanceForProof(
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
      });

      it.only("payee can claim up to their allotted amount from pool", async function () {
        let rewardSafePreviousBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        let rewardPoolPreviousBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );
        console.log(
          "reward pool previous",
          rewardPoolPreviousBalance.toString()
        );
        console.log(
          "reward safe previous",
          rewardSafePreviousBalance.toString()
        );

        const safeOwners = await rewardSafe.getOwners();
        console.log("payee", payee);
        console.log("safe owners", safeOwners);
        let balance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          { from: payee }
        );
        console.log("balance for proof", balance.toString());
        let tx = await claimReward(
          //reward manager
          rewardManager,
          rewardPool,
          relayer,
          // reward safe
          rewardSafe,
          payee,
          rewardProgramID,
          cardcpxdToken,
          paymentAmount,
          proof
        );
        // let txn = await rewardPool.claim(
        //   cardcpxdToken.address,
        //   paymentAmount,
        //   proof,
        //   {
        //     from: payee,
        //   }
        // );

        // let claimEvent = tx.logs.find((log) => log.event === "PayeeClaim");
        // assert.equal(claimEvent.args.payee, payee, "event payee is correct");
        // assert(
        //   claimEvent.args.amount.eq(paymentAmount),
        //   "event amount is correct"
        // );

        let rewardSafeNewBalance = await getBalance(
          cardcpxdToken,
          rewardSafe.address
        );
        let rewardPoolBalance = await getBalance(
          cardcpxdToken,
          rewardPool.address
        );

        // let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        // let proofBalance = await rewardPool.balanceForProof(
        //   cardcpxdToken.address,
        //   proof,
        //   {
        //     from: payee,
        //   }
        // );

        console.log("reward safe new balance", rewardSafeNewBalance.toString());
        console.log("reward pool new balance", rewardPoolBalance.toString());
        // assert(payeeBalance.eq(paymentAmount), "the payee balance is correct");
        // assert(
        //   poolBalance.eq(rewardPoolBalance.sub(paymentAmount)),
        //   "the pool balance is correct"
        // );
        // assert(claims.eq(paymentAmount), "the claims amount is correct");
        // assert.equal(Number(proofBalance), 0, "the proof balance is correct");
      });

      it("payee can make a claim less than their allotted amount from the pool", async function () {
        let claimAmount = toTokenUnit(8);
        let txn = await rewardPool.claim(
          cardcpxdToken.address,
          claimAmount,
          proof,
          {
            from: payee,
          }
        );

        let claimEvent = txn.logs.find((log) => log.event === "PayeeClaim");
        assert.equal(claimEvent.args.payee, payee, "event payee is correct");
        assert(
          claimEvent.args.amount.eq(claimAmount),
          "event amount is correct"
        );

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert.equal(
          Number(payeeBalance),
          claimAmount,
          "the payee balance is correct"
        );
        assert(
          poolBalance.eq(rewardPoolBalance.sub(claimAmount)),
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
        await rewardPool.claim(cardcpxdToken.address, toTokenUnit(4), proof, {
          from: payee,
        });
        await rewardPool.claim(cardcpxdToken.address, toTokenUnit(6), proof, {
          from: payee,
        });

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert(payeeBalance.eq(claimAmount), "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance.sub(claimAmount)),
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
        await rewardPool
          .claim(cardcpxdToken.address, claimAmount, proof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert.equal(Number(payeeBalance), 0, "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance),
          "the pool balance is correct"
        );
        assert.equal(Number(claims), 0, "the claims amount is correct");
        assert(proofBalance.eq(paymentAmount), "the proof balance is correct");
      });

      it("payee cannot claim using a proof whose metadata has been tampered with", async function () {
        let claimAmount = 11;
        // the cumulative amount in in the proof's meta has been increased artifically to 12 tokens: note the "c" in the 127th position of the proof, here ---v
        let tamperedProof =
          "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000c2e46ed0464b1e11097030a04086c9f068606b4c9808ccdac0343863c5e4f8244749e106fa8d91408f2578e5d93447f727f59279be85ce491faf212a7201d3b836b94214bff74426647e9cf0b5c5c3cbc9cef25b7e08759ca2b85357ec22c9b40";

        await rewardPool
          .claim(cardcpxdToken.address, claimAmount, tamperedProof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );
        let tamperedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          tamperedProof,
          { from: payee }
        );

        assert.equal(payeeBalance, 0, "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance),
          "the pool balance is correct"
        );
        assert.equal(Number(claims), 0, "the claims amount is correct");
        assert(proofBalance.eq(paymentAmount), "the proof balance is correct");
        assert.equal(
          tamperedProofBalance,
          0,
          "the tampered proof balance is 0 tokens"
        );
      });

      it("payee cannot make mulitple claim that total to more than their allotted amount from the pool", async function () {
        let claimAmount = toTokenUnit(4);
        await rewardPool.claim(cardcpxdToken.address, toTokenUnit(4), proof, {
          from: payee,
        });
        await rewardPool
          .claim(cardcpxdToken.address, toTokenUnit(7), proof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert(payeeBalance.eq(claimAmount), "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance.sub(claimAmount)),
          "the pool balance is correct"
        );
        assert(claims.eq(claimAmount), "the claims amount is correct");
        assert(
          proofBalance.eq(paymentAmount.sub(claimAmount)),
          "the proof balance is correct"
        );
      });

      it("payee cannot claim 0 tokens from payment pool", async function () {
        let claimAmount = toTokenUnit(0);
        await rewardPool
          .claim(cardcpxdToken.address, claimAmount, proof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Cannot claim non-positive amount");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert.equal(Number(payeeBalance), 0, "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance),
          "the pool balance is correct"
        );
        assert.equal(Number(claims), 0, "the claims amount is correct");
        assert(proofBalance.eq(paymentAmount), "the proof balance is correct");
      });

      it("non-payee cannot claim from pool", async function () {
        let claimAmount = toTokenUnit(10);
        await rewardPool
          .claim(cardcpxdToken.address, claimAmount, proof, {
            from: accounts[0],
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert.equal(payeeBalance, 0, "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance),
          "the pool balance is correct"
        );
        assert.equal(claims, 0, "the claims amount is correct");
        assert(proofBalance.eq(paymentAmount), "the proof balance is correct");
      });

      it("payee cannot claim their allotted tokens from the pool when the pool does not have enough tokens", async function () {
        let insufficientFundsPayeeIndex = 7;
        let insufficientFundsPayee =
          payments[insufficientFundsPayeeIndex].payee;
        let insufficientFundsPaymentAmount =
          payments[insufficientFundsPayeeIndex].amount;
        let insufficientFundsProof = merkleTree.hexProofForPayee(
          insufficientFundsPayee,
          cardcpxdToken.address,
          paymentCycle
        );

        await rewardPool
          .claim(
            cardcpxdToken.address,
            insufficientFundsPaymentAmount,
            insufficientFundsProof,
            { from: insufficientFundsPayee }
          )
          .should.be.rejectedWith(
            Error,
            "Reward pool has insufficient balance"
          );

        let payeeBalance = await cardcpxdToken.balanceOf(
          insufficientFundsPayee
        );
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(
          cardcpxdToken.address,
          insufficientFundsPayee
        );
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          insufficientFundsProof,
          { from: insufficientFundsPayee }
        );

        assert.equal(Number(payeeBalance), 0, "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance),
          "the pool balance is correct"
        );
        assert.equal(Number(claims), 0, "the claims amount is correct");
        assert(
          proofBalance.eq(insufficientFundsPaymentAmount),
          "the proof balance is correct"
        );
      });

      it("payee claim their allotted amount from an older proof", async function () {
        let updatedPayments = payments.slice();
        updatedPayments[payeeIndex].amount = updatedPayments[
          payeeIndex
        ].amount.add(toTokenUnit(2));
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        let updatedProof = updatedMerkleTree.hexProofForPayee(
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let claimAmount = toTokenUnit(8);
        await rewardPool.claim(cardcpxdToken.address, claimAmount, proof, {
          from: payee,
        });

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );
        let updatedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );

        assert(payeeBalance.eq(claimAmount), "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance.sub(claimAmount)),
          "the pool balance is correct"
        );
        assert(claims.eq(claimAmount), "the claims amount is correct");
        assert(
          proofBalance.eq(paymentAmount.sub(claimAmount)),
          "the proof balance is correct"
        );
        assert(
          updatedProofBalance.eq(updatedPaymentAmount.sub(claimAmount)),
          "the updated proof balance is correct"
        );
      });

      it("payee claim their allotted amount from a newer proof", async function () {
        let updatedPayments = payments.slice();
        updatedPayments[payeeIndex].amount = updatedPayments[
          payeeIndex
        ].amount.add(toTokenUnit(2));
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        let updatedProof = updatedMerkleTree.hexProofForPayee(
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let claimAmount = toTokenUnit(8);
        await rewardPool.claim(
          cardcpxdToken.address,
          claimAmount,
          updatedProof,
          {
            from: payee,
          }
        );

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );
        let updatedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );

        assert(payeeBalance.eq(claimAmount), "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance.sub(claimAmount)),
          "the pool balance is correct"
        );
        assert(claims.eq(claimAmount), "the claims amount is correct");
        assert(
          proofBalance.eq(paymentAmount.sub(claimAmount)),
          "the proof balance is correct"
        );
        assert(
          updatedProofBalance.eq(updatedPaymentAmount.sub(claimAmount)),
          "the updated proof balance is correct"
        );
      });

      it("payee claim their allotted amount from both an older and new proof", async function () {
        let updatedPayments = payments.slice();
        updatedPayments[payeeIndex].amount = updatedPayments[
          payeeIndex
        ].amount.add(toTokenUnit(2));
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        let updatedProof = updatedMerkleTree.hexProofForPayee(
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let claimAmount = toTokenUnit(8).add(toTokenUnit(4));
        await rewardPool.claim(cardcpxdToken.address, toTokenUnit(8), proof, {
          from: payee,
        });
        await rewardPool.claim(
          cardcpxdToken.address,
          toTokenUnit(4),
          updatedProof,
          {
            from: payee,
          }
        );

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );
        let updatedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );

        assert(payeeBalance.eq(claimAmount), "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance.sub(claimAmount)),
          "the pool balance is correct"
        );
        assert(claims.eq(claimAmount), "the claims amount is correct");
        assert.equal(Number(proofBalance), 0, "the proof balance is correct");
        assert(
          updatedProofBalance.eq(updatedPaymentAmount.sub(claimAmount)),

          "the updated proof balance is correct"
        );
      });

      it("does not allow a payee to exceed their provided proof's allotted amount when claim from an older proof and a newer proof", async function () {
        let updatedPayments = payments.slice();
        updatedPayments[payeeIndex].amount = updatedPayments[
          payeeIndex
        ].amount.add(toTokenUnit(2));
        let updatedPaymentAmount = updatedPayments[payeeIndex].amount;
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        let paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        let updatedProof = updatedMerkleTree.hexProofForPayee(
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(updatedRoot, { from: tally });

        let claimAmount = toTokenUnit(8);
        await rewardPool.claim(
          cardcpxdToken.address,
          claimAmount,
          updatedProof,
          {
            from: payee,
          }
        );
        rewardPool
          .claim(cardcpxdToken.address, toTokenUnit(4), proof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");
        // this proof only permits 10 - 8 tokens to be claim, even though the newer proof permits 12 - 8 tokens to be claim

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let claims = await rewardPool.claims(cardcpxdToken.address, payee);
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );
        let updatedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );

        assert(payeeBalance.eq(claimAmount), "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance.sub(claimAmount)),
          "the pool balance is correct"
        );
        assert(claims.eq(claimAmount), "the claims amount is correct");
        assert(
          proofBalance.eq(paymentAmount.sub(claimAmount)),
          "the proof balance is correct"
        );
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

      beforeEach(async function () {
        payee = accounts[11];
        erc20Token = await ERC20Token.new();
        await erc20Token.initialize(owner);
        payments = [
          {
            payee,
            token: daicpxdToken.address,
            amount: toTokenUnit(10),
          },
          {
            payee,
            token: daicpxdToken.address,
            amount: toTokenUnit(12),
          },
          {
            payee,
            token: cardcpxdToken.address,
            amount: toTokenUnit(100),
          },
          {
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
        const rewardPoolBalanceCard = await cardcpxdToken.balanceOf(
          rewardPool.address
        );
        const rewardPoolBalanceDai = await daicpxdToken.balanceOf(
          rewardPool.address
        );
        const rewardPoolBalanceErc20 = await erc20Token.balanceOf(
          rewardPool.address
        );
        assert(rewardPoolBalanceCard.eq(rewardPoolBalance));
        assert(rewardPoolBalanceDai.eq(rewardPoolBalance));
        assert(rewardPoolBalanceErc20.eq(rewardPoolBalance));
      });

      it("can claim erc20 tokens", async () => {
        const erc20Amount = toTokenUnit(5);
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });
        const erc20Proof = merkleTree.hexProofForPayee(
          payee,
          erc20Token.address,
          paymentCycle
        );
        const payeePoolBalanceBefore = await rewardPool.balanceForProofWithAddress(
          erc20Token.address,
          payee,
          erc20Proof
        );
        await rewardPool.claim(erc20Token.address, erc20Amount, erc20Proof, {
          from: payee,
        });
        const payeePoolBalanceAfter = await rewardPool.balanceForProofWithAddress(
          erc20Token.address,
          payee,
          erc20Proof
        );
        const payeeBalanceAfter = await erc20Token.balanceOf(payee);
        const rewardPoolBalanceErc20After = await erc20Token.balanceOf(
          rewardPool.address
        );
        assert(
          payeePoolBalanceBefore.eq(payeePoolBalanceAfter.add(erc20Amount))
        );
        assert(payeeBalanceAfter.eq(erc20Amount));
        assert(
          rewardPoolBalanceErc20After.eq(rewardPoolBalance.sub(erc20Amount))
        );
      });

      //TODO
      it("can claim nft tokens", async () => {});

      it("claim data aggregate is correct", async () => {
        const daiProof = merkleTree.hexProofForPayee(
          payee,
          daicpxdToken.address,
          paymentCycle
        );
        const cardProof = merkleTree.hexProofForPayee(
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        const claim = merkleTree.claimData(payee, paymentCycle);

        const { proof: daiProofPrime, amount: daiAvailable } = _.find(claim, {
          token: daicpxdToken.address,
        });
        const { proof: cardProofPrime, amount: cardAvailable } = _.find(claim, {
          token: cardcpxdToken.address,
        });
        assert.equal(claim.length, 3);
        assert.equal(daiProof, daiProofPrime);
        assert.equal(cardProof, cardProofPrime);
        assert(cardAvailable.eq(toTokenUnit(100)));
        assert(daiAvailable.eq(toTokenUnit(22)));
      });

      it("claim from two different tokens", async () => {
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });
        const cardProof = merkleTree.hexProofForPayee(
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        const daiProof = merkleTree.hexProofForPayee(
          payee,
          daicpxdToken.address,
          paymentCycle
        );
        const daiBalanceBefore = await rewardPool.balanceForProofWithAddress(
          daicpxdToken.address,
          payee,
          daiProof
        );
        const cardBalanceBefore = await rewardPool.balanceForProofWithAddress(
          cardcpxdToken.address,
          payee,
          cardProof
        );
        const amountCard = toTokenUnit(50);
        const amountDai = daiBalanceBefore;
        assert(amountCard.lte(cardBalanceBefore));
        assert(amountDai.lte(daiBalanceBefore));
        await rewardPool.claim(cardcpxdToken.address, amountCard, cardProof, {
          from: payee,
        });
        await rewardPool.claim(daicpxdToken.address, amountDai, daiProof, {
          from: payee,
        });
        const daiBalanceAfter = await rewardPool.balanceForProofWithAddress(
          daicpxdToken.address,
          payee,
          daiProof
        );
        const cardBalanceAfter = await rewardPool.balanceForProofWithAddress(
          cardcpxdToken.address,
          payee,
          cardProof
        );
        const payeeCardBalance = await cardcpxdToken.balanceOf(payee);
        const payeeDaiBalance = await daicpxdToken.balanceOf(payee);
        assert(cardBalanceBefore.eq(cardBalanceAfter.add(amountCard)));
        assert(daiBalanceBefore.eq(daiBalanceAfter.add(amountDai)));
        assert(payeeCardBalance.eq(amountCard));
        assert(payeeDaiBalance.eq(amountDai));
      });
    });
  });
});
