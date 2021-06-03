const CumulativePaymentTree = require("./utils/cumulative-payment-tree");

const { TOKEN_DETAIL_DATA, assert } = require("./setup");
const { toTokenUnit, advanceBlock } = require("./utils/helper");
const _ = require("lodash");

const ERC20Token = artifacts.require(
  "@openzeppelin/contract-upgradeable/contracts/token/ERC20/ERC20Mintable.sol"
);
const ERC677Token = artifacts.require("ERC677Token.sol");
const RewardPool = artifacts.require("RewardPool.sol");

contract("RewardPool", function (accounts) {
  let owner;
  let tally;
  let rewardPool;
  let daicpxdToken;
  let cardcpxdToken;
  let payments;
  describe("Reward Pool", function () {
    beforeEach(async function () {
      owner = accounts[0];
      tally = accounts[1];
      daicpxdToken = await ERC677Token.new();
      await daicpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
      cardcpxdToken = await ERC677Token.new();
      await cardcpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
      payments = [
        {
          payee: accounts[2],
          token: cardcpxdToken.address,
          amount: toTokenUnit(10),
        },
        {
          payee: accounts[3],
          token: cardcpxdToken.address,
          amount: toTokenUnit(12),
        },
        {
          payee: accounts[4],
          token: cardcpxdToken.address,
          amount: toTokenUnit(2),
        },
        {
          payee: accounts[5],
          token: cardcpxdToken.address,
          amount: toTokenUnit(1),
        },
        {
          payee: accounts[6],
          token: cardcpxdToken.address,
          amount: toTokenUnit(32),
        },
        {
          payee: accounts[7],
          token: cardcpxdToken.address,
          amount: toTokenUnit(10),
        },
        {
          payee: accounts[8],
          token: cardcpxdToken.address,
          amount: toTokenUnit(9),
        },
        {
          payee: accounts[9],
          token: cardcpxdToken.address,
          amount: toTokenUnit(101), // this amount is used to test logic when the payment pool doesn't have sufficient funds
        },
      ];
      rewardPool = await RewardPool.new();
      await rewardPool.initialize(owner);
      await rewardPool.setup(tally, [
        cardcpxdToken.address,
        daicpxdToken.address,
      ]);
    });

    afterEach(async function () {
      payments[0].amount = toTokenUnit(10); // one of the tests is bleeding state...
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
          .submitPayeeMerkleRoot(root, { from: accounts[2] })
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
          { from: payee }
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

    describe("withdraw", function () {
      let rewardPoolBalance;
      let paymentCycle;
      let proof;
      let payeeIndex = 0;
      let payee;
      let paymentAmount;
      let merkleTree;
      let root;

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
      });

      it("payee can withdraw up to their allotted amount from pool", async function () {
        let txn = await rewardPool.withdraw(
          cardcpxdToken.address,
          paymentAmount,
          proof,
          {
            from: payee,
          }
        );

        let withdrawEvent = txn.logs.find(
          (log) => log.event === "PayeeWithdraw"
        );
        assert.equal(withdrawEvent.args.payee, payee, "event payee is correct");
        assert(
          withdrawEvent.args.amount.eq(paymentAmount),
          "event amount is correct"
        );

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert(payeeBalance.eq(paymentAmount), "the payee balance is correct");
        assert(
          poolBalance.eq(rewardPoolBalance.sub(paymentAmount)),
          "the pool balance is correct"
        );
        assert(
          withdrawals.eq(paymentAmount),
          "the withdrawals amount is correct"
        );
        assert.equal(Number(proofBalance), 0, "the proof balance is correct");
      });

      it("payee can make a withdrawal less than their allotted amount from the pool", async function () {
        let withdrawalAmount = toTokenUnit(8);
        let txn = await rewardPool.withdraw(
          cardcpxdToken.address,
          withdrawalAmount,
          proof,
          {
            from: payee,
          }
        );

        let withdrawEvent = txn.logs.find(
          (log) => log.event === "PayeeWithdraw"
        );
        assert.equal(withdrawEvent.args.payee, payee, "event payee is correct");
        assert(
          withdrawEvent.args.amount.eq(withdrawalAmount),
          "event amount is correct"
        );

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert.equal(
          Number(payeeBalance),
          withdrawalAmount,
          "the payee balance is correct"
        );
        assert(
          poolBalance.eq(rewardPoolBalance.sub(withdrawalAmount)),
          "the pool balance is correct"
        );
        assert(
          withdrawals.eq(withdrawalAmount),
          "the withdrawals amount is correct"
        );
        assert(
          proofBalance.eq(paymentAmount.sub(withdrawalAmount)),
          "the proof balance is correct"
        );
      });

      it("payee can make mulitple withdrawls within their allotted amount from the pool", async function () {
        let withdrawalAmount = toTokenUnit(4).add(toTokenUnit(6));
        await rewardPool.withdraw(
          cardcpxdToken.address,
          toTokenUnit(4),
          proof,
          {
            from: payee,
          }
        );
        await rewardPool.withdraw(
          cardcpxdToken.address,
          toTokenUnit(6),
          proof,
          {
            from: payee,
          }
        );

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert(
          payeeBalance.eq(withdrawalAmount),
          "the payee balance is correct"
        );
        assert(
          poolBalance.eq(rewardPoolBalance.sub(withdrawalAmount)),
          "the pool balance is correct"
        );
        assert(
          withdrawals.eq(withdrawalAmount),
          "the withdrawals amount is correct"
        );
        assert(
          proofBalance.eq(paymentAmount.sub(withdrawalAmount)),
          "the proof balance is correct"
        );
      });

      it("payee cannot withdraw more than their allotted amount from the pool", async function () {
        let withdrawalAmount = toTokenUnit(11);
        await rewardPool
          .withdraw(cardcpxdToken.address, withdrawalAmount, proof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
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
        assert.equal(
          Number(withdrawals),
          0,
          "the withdrawals amount is correct"
        );
        assert(proofBalance.eq(paymentAmount), "the proof balance is correct");
      });

      it("payee cannot withdraw using a proof whose metadata has been tampered with", async function () {
        let withdrawalAmount = 11;
        // the cumulative amount in in the proof's meta has been increased artifically to 12 tokens: note the "c" in the 127th position of the proof, here ---v
        let tamperedProof =
          "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000c2e46ed0464b1e11097030a04086c9f068606b4c9808ccdac0343863c5e4f8244749e106fa8d91408f2578e5d93447f727f59279be85ce491faf212a7201d3b836b94214bff74426647e9cf0b5c5c3cbc9cef25b7e08759ca2b85357ec22c9b40";

        await rewardPool
          .withdraw(cardcpxdToken.address, withdrawalAmount, tamperedProof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
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
        assert.equal(
          Number(withdrawals),
          0,
          "the withdrawals amount is correct"
        );
        assert(proofBalance.eq(paymentAmount), "the proof balance is correct");
        assert.equal(
          tamperedProofBalance,
          0,
          "the tampered proof balance is 0 tokens"
        );
      });

      it("payee cannot make mulitple withdrawls that total to more than their allotted amount from the pool", async function () {
        let withdrawalAmount = toTokenUnit(4);
        await rewardPool.withdraw(
          cardcpxdToken.address,
          toTokenUnit(4),
          proof,
          {
            from: payee,
          }
        );
        await rewardPool
          .withdraw(cardcpxdToken.address, toTokenUnit(7), proof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
        let proofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          {
            from: payee,
          }
        );

        assert(
          payeeBalance.eq(withdrawalAmount),
          "the payee balance is correct"
        );
        assert(
          poolBalance.eq(rewardPoolBalance.sub(withdrawalAmount)),
          "the pool balance is correct"
        );
        assert(
          withdrawals.eq(withdrawalAmount),
          "the withdrawals amount is correct"
        );
        assert(
          proofBalance.eq(paymentAmount.sub(withdrawalAmount)),
          "the proof balance is correct"
        );
      });

      it("payee cannot withdraw 0 tokens from payment pool", async function () {
        let withdrawalAmount = toTokenUnit(0);
        await rewardPool
          .withdraw(cardcpxdToken.address, withdrawalAmount, proof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Cannot withdraw non-positive amount");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
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
        assert.equal(
          Number(withdrawals),
          0,
          "the withdrawals amount is correct"
        );
        assert(proofBalance.eq(paymentAmount), "the proof balance is correct");
      });

      it("non-payee cannot withdraw from pool", async function () {
        let withdrawalAmount = toTokenUnit(10);
        await rewardPool
          .withdraw(cardcpxdToken.address, withdrawalAmount, proof, {
            from: accounts[0],
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
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
        assert.equal(withdrawals, 0, "the withdrawals amount is correct");
        assert(proofBalance.eq(paymentAmount), "the proof balance is correct");
      });

      it("payee cannot withdraw their allotted tokens from the pool when the pool does not have enough tokens", async function () {
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
          .withdraw(
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
        let withdrawals = await rewardPool.withdrawals(
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
        assert.equal(
          Number(withdrawals),
          0,
          "the withdrawals amount is correct"
        );
        assert(
          proofBalance.eq(insufficientFundsPaymentAmount),
          "the proof balance is correct"
        );
      });

      it("payee withdraws their allotted amount from an older proof", async function () {
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

        let withdrawalAmount = toTokenUnit(8);
        await rewardPool.withdraw(
          cardcpxdToken.address,
          withdrawalAmount,
          proof,
          { from: payee }
        );

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
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

        assert(
          payeeBalance.eq(withdrawalAmount),
          "the payee balance is correct"
        );
        assert(
          poolBalance.eq(rewardPoolBalance.sub(withdrawalAmount)),
          "the pool balance is correct"
        );
        assert(
          withdrawals.eq(withdrawalAmount),
          "the withdrawals amount is correct"
        );
        assert(
          proofBalance.eq(paymentAmount.sub(withdrawalAmount)),
          "the proof balance is correct"
        );
        assert(
          updatedProofBalance.eq(updatedPaymentAmount.sub(withdrawalAmount)),
          "the updated proof balance is correct"
        );
      });

      it("payee withdraws their allotted amount from a newer proof", async function () {
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

        let withdrawalAmount = toTokenUnit(8);
        await rewardPool.withdraw(
          cardcpxdToken.address,
          withdrawalAmount,
          updatedProof,
          {
            from: payee,
          }
        );

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
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

        assert(
          payeeBalance.eq(withdrawalAmount),
          "the payee balance is correct"
        );
        assert(
          poolBalance.eq(rewardPoolBalance.sub(withdrawalAmount)),
          "the pool balance is correct"
        );
        assert(
          withdrawals.eq(withdrawalAmount),
          "the withdrawals amount is correct"
        );
        assert(
          proofBalance.eq(paymentAmount.sub(withdrawalAmount)),
          "the proof balance is correct"
        );
        assert(
          updatedProofBalance.eq(updatedPaymentAmount.sub(withdrawalAmount)),
          "the updated proof balance is correct"
        );
      });

      it("payee withdraws their allotted amount from both an older and new proof", async function () {
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

        let withdrawalAmount = toTokenUnit(8).add(toTokenUnit(4));
        await rewardPool.withdraw(
          cardcpxdToken.address,
          toTokenUnit(8),
          proof,
          {
            from: payee,
          }
        );
        await rewardPool.withdraw(
          cardcpxdToken.address,
          toTokenUnit(4),
          updatedProof,
          {
            from: payee,
          }
        );

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
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

        assert(
          payeeBalance.eq(withdrawalAmount),
          "the payee balance is correct"
        );
        assert(
          poolBalance.eq(rewardPoolBalance.sub(withdrawalAmount)),
          "the pool balance is correct"
        );
        assert(
          withdrawals.eq(withdrawalAmount),
          "the withdrawals amount is correct"
        );
        assert.equal(Number(proofBalance), 0, "the proof balance is correct");
        assert(
          updatedProofBalance.eq(updatedPaymentAmount.sub(withdrawalAmount)),

          "the updated proof balance is correct"
        );
      });

      it("does not allow a payee to exceed their provided proof's allotted amount when withdrawing from an older proof and a newer proof", async function () {
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

        let withdrawalAmount = toTokenUnit(8);
        await rewardPool.withdraw(
          cardcpxdToken.address,
          withdrawalAmount,
          updatedProof,
          {
            from: payee,
          }
        );
        rewardPool
          .withdraw(cardcpxdToken.address, toTokenUnit(4), proof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "Insufficient balance for proof");
        // this proof only permits 10 - 8 tokens to be withdrawn, even though the newer proof permits 12 - 8 tokens to be withdrawn

        let payeeBalance = await cardcpxdToken.balanceOf(payee);
        let poolBalance = await cardcpxdToken.balanceOf(rewardPool.address);
        let withdrawals = await rewardPool.withdrawals(
          cardcpxdToken.address,
          payee
        );
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

        assert(
          payeeBalance.eq(withdrawalAmount),
          "the payee balance is correct"
        );
        assert(
          poolBalance.eq(rewardPoolBalance.sub(withdrawalAmount)),
          "the pool balance is correct"
        );
        assert(
          withdrawals.eq(withdrawalAmount),
          "the withdrawals amount is correct"
        );
        assert(
          proofBalance.eq(paymentAmount.sub(withdrawalAmount)),
          "the proof balance is correct"
        );
        assert(
          updatedProofBalance.eq(updatedPaymentAmount.sub(withdrawalAmount)),
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
        payee = accounts[2];
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
        await rewardPool.addPayableToken(erc20Token.address);
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

      it("cannot withdraw if payable token not added", async () => {
        const newCardcpxdToken = await ERC677Token.new();
        await newCardcpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
        await newCardcpxdToken.mint(
          rewardPool.address,
          toTokenUnit(rewardPoolBalance)
        );
        payments.push({
          payee,
          token: newCardcpxdToken.address,
          amount: rewardPoolBalance,
        });
        merkleTree = new CumulativePaymentTree(payments);
        root = merkleTree.getHexRoot();
        let registeredTokens = await rewardPool.getTokens();
        assert(registeredTokens.length == 3);
        assert(_.includes(registeredTokens, cardcpxdToken.address));
        assert(_.includes(registeredTokens, daicpxdToken.address));
        assert(!_.includes(registeredTokens, newCardcpxdToken.address));
        await rewardPool.submitPayeeMerkleRoot(root, { from: tally });
        const cardProof = merkleTree.hexProofForPayee(
          payee,
          newCardcpxdToken.address,
          paymentCycle
        );
        const amountCard = toTokenUnit(50);
        await rewardPool
          .withdraw(newCardcpxdToken.address, amountCard, cardProof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "unaccepted token");
        registeredTokens = await rewardPool.getTokens();
      });

      it("can withdraw erc20 tokens", async () => {
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
        await rewardPool.withdraw(erc20Token.address, erc20Amount, erc20Proof, {
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

      it("withdraw data aggregate is correct", async () => {
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
        const withdrawDataForPayee = merkleTree.withdrawData(
          payee,
          paymentCycle
        );

        const { proof: daiProofPrime, amount: daiAvailable } = _.find(
          withdrawDataForPayee,
          {
            token: daicpxdToken.address,
          }
        );
        const { proof: cardProofPrime, amount: cardAvailable } = _.find(
          withdrawDataForPayee,
          {
            token: cardcpxdToken.address,
          }
        );
        assert.equal(withdrawDataForPayee.length, 3);
        assert.equal(daiProof, daiProofPrime);
        assert.equal(cardProof, cardProofPrime);
        assert(cardAvailable.eq(toTokenUnit(100)));
        assert(daiAvailable.eq(toTokenUnit(22)));
      });

      it("withdraw from two different tokens", async () => {
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
        await rewardPool.withdraw(
          cardcpxdToken.address,
          amountCard,
          cardProof,
          {
            from: payee,
          }
        );
        await rewardPool.withdraw(daicpxdToken.address, amountDai, daiProof, {
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
