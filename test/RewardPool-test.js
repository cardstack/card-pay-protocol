const CumulativePaymentTree = require("./utils/cumulative-payment-tree");

const { TOKEN_DETAIL_DATA } = require("./setup");
const {
  toTokenUnit,
  setupExchanges,
  advanceBlock,
  assertRevert,
} = require("./utils/helper");
const assert = require("assert");
const _ = require("lodash");
const { soliditySha3 } = require("web3-utils");

const ERC20Token = artifacts.require(
  "@openzeppelin/contract-upgradeable/contracts/token/ERC20/ERC20Mintable.sol"
);
const RewardPool = artifacts.require("RewardPool.sol");
const ERC677Token = artifacts.require("ERC677Token.sol");

contract("RewardPool", function (accounts) {
  let owner;
  let rewardPool;
  let daicpxdToken;
  let cardcpxdToken;
  let payments;
  let initialBlockNumber;
  describe("Reward Pool", function () {
    beforeEach(async function () {
      owner = accounts[0];
      ({ daicpxdToken, cardcpxdToken } = await setupExchanges(owner));
      payments = [
        {
          payee: accounts[2],
          token: cardcpxdToken.address,
          amount: 10,
        },
        {
          payee: accounts[3],
          token: cardcpxdToken.address,
          amount: 12,
        },
        {
          payee: accounts[4],
          token: cardcpxdToken.address,
          amount: 2,
        },
        {
          payee: accounts[5],
          token: cardcpxdToken.address,
          amount: 1,
        },
        {
          payee: accounts[6],
          token: cardcpxdToken.address,
          amount: 32,
        },
        {
          payee: accounts[7],
          token: cardcpxdToken.address,
          amount: 10,
        },
        {
          payee: accounts[8],
          token: cardcpxdToken.address,
          amount: 9,
        },
        {
          payee: accounts[9],
          token: cardcpxdToken.address,
          amount: 101, // this amount is used to test logic when the payment pool doesn't have sufficient funds
        },
      ];
      rewardPool = await RewardPool.new();
      await rewardPool.initialize(owner);
      await rewardPool.setup([cardcpxdToken.address, daicpxdToken.address]);
      initialBlockNumber = await web3.eth.getBlockNumber();
    });

    afterEach(async function () {
      payments[0].amount = 10; // one of the tests is bleeding state...
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

        let txn = await rewardPool.submitPayeeMerkleRoot(root);
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
          initialBlockNumber,
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
        await rewardPool.submitPayeeMerkleRoot(root);

        let updatedPayments = payments.slice();
        updatedPayments[0].amount += 10;
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await advanceBlock(web3);

        await rewardPool.submitPayeeMerkleRoot(updatedRoot);

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
        await rewardPool.submitPayeeMerkleRoot(root);

        let updatedPayments = payments.slice();
        updatedPayments[0].amount += 10;
        let updatedMerkleTree = new CumulativePaymentTree(updatedPayments);
        let updatedRoot = updatedMerkleTree.getHexRoot();

        await assertRevert(
          async () => await rewardPool.submitPayeeMerkleRoot(updatedRoot)
        );

        let paymentCycleNumber = await rewardPool.numPaymentCycles();

        assert.equal(
          paymentCycleNumber.toNumber(),
          2,
          "the payment cycle number is correct"
        );
      });

      it("does not allow non-owner to submit merkle root", async function () {
        let merkleTree = new CumulativePaymentTree(payments);
        let root = merkleTree.getHexRoot();

        await assertRevert(async () =>
          rewardPool.submitPayeeMerkleRoot(root, { from: accounts[2] })
        );
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
        rewardPoolBalance = 100;
        paymentAmount = payments[payeeIndex].amount;
        await cardcpxdToken.mint(
          rewardPool.address,
          toTokenUnit(rewardPoolBalance)
        );
        paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        merkleTree = new CumulativePaymentTree(payments);
        proof = merkleTree.hexProofForPayee(
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        root = merkleTree.getHexRoot();
        await rewardPool.submitPayeeMerkleRoot(root);
      });

      it("payee can get their available balance in the payment pool from their proof", async function () {
        let balance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          { from: payee }
        );
        assert.equal(
          balance.toNumber(),
          paymentAmount,
          "the balance is correct"
        );
      });

      it("non-payee can get the available balance in the payment pool for an address and proof", async function () {
        let balance = await rewardPool.balanceForProofWithAddress(
          cardcpxdToken.address,
          payee,
          proof
        );
        assert.equal(
          balance.toNumber(),
          paymentAmount,
          "the balance is correct"
        );
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
        assert.equal(balance.toNumber(), 0, "the balance is correct");
      });

      it("garbage proof data returns a balance of 0 in payment pool", async function () {
        const randomProof = web3.utils.randomHex(32 * 5);
        let balance = await rewardPool.balanceForProofWithAddress(
          cardcpxdToken.address,
          payee,
          randomProof
        );
        assert.equal(balance.toNumber(), 0, "the balance is correct");
      });

      it("can handle balance for proofs from different payment cycles", async function () {
        let updatedPayments = payments.slice();
        let updatedPaymentAmount = 20;
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
        await rewardPool.submitPayeeMerkleRoot(updatedRoot);

        let balance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          {
            from: payee,
          }
        );
        assert.equal(
          balance.toNumber(),
          updatedPaymentAmount,
          "the balance is correct for the updated proof"
        );

        balance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          proof,
          { from: payee }
        );
        assert.equal(
          balance.toNumber(),
          paymentAmount,
          "the balance is correct for the original proof"
        );
      });

      it("balance of payee that has 0 tokens in payment list returns 0 balance in payment pool", async function () {
        let aPayee = accounts[1];
        let updatedPayments = payments.slice();
        updatedPayments.push({ payee: aPayee, amount: 0 });
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
        await rewardPool.submitPayeeMerkleRoot(updatedRoot);

        let balance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          {
            from: aPayee,
          }
        );
        assert.equal(
          balance.toNumber(),
          0,
          "the balance is correct for the updated proof"
        );
      });

      it("balance of proof for payee that has mulitple entries in the payment list returns the sum of all their amounts in the payment pool", async function () {
        let updatedPayments = payments.slice();
        updatedPayments.push({
          payee,
          token: cardcpxdToken.address,
          amount: 8,
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
        await rewardPool.submitPayeeMerkleRoot(updatedRoot);

        let balance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          {
            from: payee,
          }
        );
        assert.equal(
          balance.toNumber(),
          18,
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
        rewardPoolBalance = 100;
        await cardcpxdToken.mint(rewardPool.address, rewardPoolBalance);
        paymentCycle = await rewardPool.numPaymentCycles();
        paymentCycle = paymentCycle.toNumber();
        proof = merkleTree.hexProofForPayee(
          payee,
          cardcpxdToken.address,
          paymentCycle
        );
        await rewardPool.submitPayeeMerkleRoot(root);
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
        assert.equal(
          withdrawEvent.args.amount.toNumber(),
          paymentAmount,
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
          payeeBalance.toNumber(),
          paymentAmount,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance - paymentAmount,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          paymentAmount,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          0,
          "the proof balance is correct"
        );
      });

      it("payee can make a withdrawal less than their allotted amount from the pool", async function () {
        let withdrawalAmount = 8;
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
        assert.equal(
          withdrawEvent.args.amount.toNumber(),
          withdrawalAmount,
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
          payeeBalance.toNumber(),
          withdrawalAmount,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance - withdrawalAmount,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          withdrawalAmount,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount - withdrawalAmount,
          "the proof balance is correct"
        );
      });

      it("payee can make mulitple withdrawls within their allotted amount from the pool", async function () {
        let withdrawalAmount = 4 + 6;
        await rewardPool.withdraw(cardcpxdToken.address, 4, proof, {
          from: payee,
        });
        await rewardPool.withdraw(cardcpxdToken.address, 6, proof, {
          from: payee,
        });

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
          payeeBalance.toNumber(),
          withdrawalAmount,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance - withdrawalAmount,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          withdrawalAmount,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount - withdrawalAmount,
          "the proof balance is correct"
        );
      });

      it("payee cannot withdraw more than their allotted amount from the pool", async function () {
        let withdrawalAmount = 11;
        await assertRevert(
          async () =>
            await rewardPool.withdraw(
              cardcpxdToken.address,
              withdrawalAmount,
              proof,
              { from: payee }
            )
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
          payeeBalance.toNumber(),
          0,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          0,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount,
          "the proof balance is correct"
        );
      });

      it("payee cannot withdraw using a proof whose metadata has been tampered with", async function () {
        let withdrawalAmount = 11;
        // the cumulative amount in in the proof's meta has been increased artifically to 12 tokens: note the "c" in the 127th position of the proof, here ---v
        let tamperedProof =
          "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000c2e46ed0464b1e11097030a04086c9f068606b4c9808ccdac0343863c5e4f8244749e106fa8d91408f2578e5d93447f727f59279be85ce491faf212a7201d3b836b94214bff74426647e9cf0b5c5c3cbc9cef25b7e08759ca2b85357ec22c9b40";

        await assertRevert(
          async () =>
            await rewardPool.withdraw(
              cardcpxdToken.address,
              withdrawalAmount,
              tamperedProof,
              {
                from: payee,
              }
            )
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
        let tamperedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          tamperedProof,
          { from: payee }
        );

        assert.equal(
          payeeBalance.toNumber(),
          0,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          0,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount,
          "the proof balance is correct"
        );
        assert.equal(
          tamperedProofBalance.toNumber(),
          0,
          "the tampered proof balance is 0 tokens"
        );
      });

      it("payee cannot make mulitple withdrawls that total to more than their allotted amount from the pool", async function () {
        let withdrawalAmount = 4;
        await rewardPool.withdraw(cardcpxdToken.address, 4, proof, {
          from: payee,
        });
        await assertRevert(
          async () =>
            await rewardPool.withdraw(cardcpxdToken.address, 7, proof, {
              from: payee,
            })
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
          payeeBalance.toNumber(),
          withdrawalAmount,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance - withdrawalAmount,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          withdrawalAmount,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount - withdrawalAmount,
          "the proof balance is correct"
        );
      });

      it("payee cannot withdraw 0 tokens from payment pool", async function () {
        let withdrawalAmount = 0;
        await assertRevert(
          async () =>
            await rewardPool.withdraw(
              cardcpxdToken.address,
              withdrawalAmount,
              proof,
              { from: payee }
            )
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
          payeeBalance.toNumber(),
          0,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          0,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount,
          "the proof balance is correct"
        );
      });

      it("non-payee cannot withdraw from pool", async function () {
        let withdrawalAmount = 10;
        await assertRevert(
          async () =>
            await rewardPool.withdraw(
              cardcpxdToken.address,
              withdrawalAmount,
              proof,
              {
                from: accounts[0],
              }
            )
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
          payeeBalance.toNumber(),
          0,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          0,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount,
          "the proof balance is correct"
        );
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

        await assertRevert(
          async () =>
            await rewardPool.withdraw(
              cardcpxdToken.address,
              insufficientFundsPaymentAmount,
              insufficientFundsProof,
              { from: insufficientFundsPayee }
            )
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

        assert.equal(
          payeeBalance.toNumber(),
          0,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          0,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          insufficientFundsPaymentAmount,
          "the proof balance is correct"
        );
      });

      it("payee withdraws their allotted amount from an older proof", async function () {
        let updatedPayments = payments.slice();
        updatedPayments[payeeIndex].amount += 2;
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
        await rewardPool.submitPayeeMerkleRoot(updatedRoot);

        let withdrawalAmount = 8;
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
        let udpatedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );

        assert.equal(
          payeeBalance.toNumber(),
          withdrawalAmount,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance - withdrawalAmount,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          withdrawalAmount,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount - withdrawalAmount,
          "the proof balance is correct"
        );
        assert.equal(
          udpatedProofBalance.toNumber(),
          updatedPaymentAmount - withdrawalAmount,
          "the updated proof balance is correct"
        );
      });

      it("payee withdraws their allotted amount from a newer proof", async function () {
        let updatedPayments = payments.slice();
        updatedPayments[payeeIndex].amount += 2;
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
        await rewardPool.submitPayeeMerkleRoot(updatedRoot);

        let withdrawalAmount = 8;
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
        let udpatedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );

        assert.equal(
          payeeBalance.toNumber(),
          withdrawalAmount,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance - withdrawalAmount,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          withdrawalAmount,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount - withdrawalAmount,
          "the proof balance is correct"
        );
        assert.equal(
          udpatedProofBalance.toNumber(),
          updatedPaymentAmount - withdrawalAmount,
          "the updated proof balance is correct"
        );
      });

      it("payee withdraws their allotted amount from both an older and new proof", async function () {
        let updatedPayments = payments.slice();
        updatedPayments[payeeIndex].amount += 2;
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
        await rewardPool.submitPayeeMerkleRoot(updatedRoot);

        let withdrawalAmount = 8 + 4;
        await rewardPool.withdraw(cardcpxdToken.address, 8, proof, {
          from: payee,
        });
        await rewardPool.withdraw(cardcpxdToken.address, 4, updatedProof, {
          from: payee,
        });

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
        let udpatedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );

        assert.equal(
          payeeBalance.toNumber(),
          withdrawalAmount,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance - withdrawalAmount,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          withdrawalAmount,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          0,
          "the proof balance is correct"
        );
        assert.equal(
          udpatedProofBalance.toNumber(),
          updatedPaymentAmount - withdrawalAmount,
          "the updated proof balance is correct"
        );
      });

      it("does not allow a payee to exceed their provided proof's allotted amount when withdrawing from an older proof and a newer proof", async function () {
        let updatedPayments = payments.slice();
        updatedPayments[payeeIndex].amount += 2;
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
        await rewardPool.submitPayeeMerkleRoot(updatedRoot);

        let withdrawalAmount = 8;
        await rewardPool.withdraw(cardcpxdToken.address, 8, updatedProof, {
          from: payee,
        });
        await assertRevert(async () =>
          rewardPool.withdraw(cardcpxdToken.address, 4, proof, { from: payee })
        ); // this proof only permits 10 - 8 tokens to be withdrawn, even though the newer proof permits 12 - 8 tokens to be withdrawn

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
        let udpatedProofBalance = await rewardPool.balanceForProof(
          cardcpxdToken.address,
          updatedProof,
          { from: payee }
        );

        assert.equal(
          payeeBalance.toNumber(),
          withdrawalAmount,
          "the payee balance is correct"
        );
        assert.equal(
          poolBalance.toNumber(),
          rewardPoolBalance - withdrawalAmount,
          "the pool balance is correct"
        );
        assert.equal(
          withdrawals.toNumber(),
          withdrawalAmount,
          "the withdrawals amount is correct"
        );
        assert.equal(
          proofBalance.toNumber(),
          paymentAmount - withdrawalAmount,
          "the proof balance is correct"
        );
        assert.equal(
          udpatedProofBalance.toNumber(),
          updatedPaymentAmount - withdrawalAmount,
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
            amount: 10,
          },
          {
            payee,
            token: daicpxdToken.address,
            amount: 12,
          },
          {
            payee,
            token: cardcpxdToken.address,
            amount: 100,
          },
          {
            payee,
            token: erc20Token.address,
            amount: 10,
          },
        ];

        rewardPoolBalance = 500;
        await cardcpxdToken.mint(
          rewardPool.address,
          toTokenUnit(rewardPoolBalance)
        );
        await daicpxdToken.mint(
          rewardPool.address,
          toTokenUnit(rewardPoolBalance)
        );
        await erc20Token.mint(
          rewardPool.address,
          toTokenUnit(rewardPoolBalance)
        );
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
        // console.log(Number(rewardPoolBalanceCard), rewardPoolBalance);
        // console.log(Number(rewardPoolBalanceCard), rewardPoolBalance);
        // assert.equal(Number(rewardPoolBalanceCard), rewardPoolBalance);
        // assert.equal(Number(rewardPoolBalanceDai), rewardPoolBalance);
      });

      it("cannot withdraw if payable token not added", async () => {
        ({ cardcpxdToken: newCardcpxdToken } = await setupExchanges(owner));
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
        await rewardPool.submitPayeeMerkleRoot(root);
        const cardProof = merkleTree.hexProofForPayee(
          payee,
          newCardcpxdToken.address,
          paymentCycle
        );
        const amountCard = 50;
        await rewardPool
          .withdraw(newCardcpxdToken.address, amountCard, cardProof, {
            from: payee,
          })
          .should.be.rejectedWith(Error, "unaccepted token");
        registeredTokens = await rewardPool.getTokens();
      });

      it("erc20 tokens supported", async () => {
        let registeredTokens = await rewardPool.getTokens();
        await rewardPool.submitPayeeMerkleRoot(root);
        const erc20Proof = merkleTree.hexProofForPayee(
          payee,
          erc20Token.address,
          paymentCycle
        );
        const erc20BalanceBefore = await rewardPool.balanceForProofWithAddress(
          erc20Token.address,
          payee,
          erc20Proof
        );
        await rewardPool.withdraw(erc20Token.address, 5, erc20Proof, {
          from: payee,
        });
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
        assert.equal(cardAvailable, 100);
        assert.equal(daiAvailable, 22);
      });

      it("withdraw from two different tokens", async () => {
        await rewardPool.submitPayeeMerkleRoot(root);
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
        const amountCard = 50;
        const amountDai = daiBalanceBefore;
        assert(amountCard <= Number(cardBalanceBefore));
        assert(amountDai <= Number(daiBalanceBefore));
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
        assert.equal(
          Number(cardBalanceBefore),
          Number(cardBalanceAfter) + amountCard
        );
        assert.equal(
          Number(daiBalanceBefore),
          Number(daiBalanceAfter) + amountDai
        );
        assert.equal(Number(payeeCardBalance), Number(amountCard));
        assert.equal(Number(payeeDaiBalance), Number(amountDai));
      });
    });

    describe("hash functions are accurate", function () {
      let node;
      beforeEach(function () {
        node = payments[0];
      });
      it("checksum/non-checksum addresses output same hash", function () {
        console.log(
          soliditySha3(
            { t: "address", v: node["token"] },
            { t: "address", v: node["payee"] },
            { t: "uint256", v: node["amount"] }
          )
        );
        assert.equal(
          soliditySha3(
            { t: "address", v: node["token"] },
            { t: "address", v: node["payee"] },
            { t: "uint256", v: node["amount"] }
          ),
          "0x2f1076cce52e3499f29b804e7d2411b7182c7ecc70d2d7defb7f47d52f6a8787"
        );
        assert.equal(
          soliditySha3(
            { t: "address", v: node["token"] },
            { t: "address", v: toHex(node["payee"]) },
            { t: "uint256", v: node["amount"] }
          ),
          "0x2f1076cce52e3499f29b804e7d2411b7182c7ecc70d2d7defb7f47d52f6a8787"
        );
        assert.equal(
          soliditySha3(
            { t: "address", v: node["token"] },
            { t: "address", v: node["payee"].replace("0x", "") },
            { t: "uint256", v: node["amount"] }
          ),
          "0x2f1076cce52e3499f29b804e7d2411b7182c7ecc70d2d7defb7f47d52f6a8787"
        );
        assert.equal(
          soliditySha3(
            { t: "address", v: node["token"] },
            { t: "address", v: toHex(node["payee"]).replace("0x", "") },
            { t: "uint256", v: node["amount"] }
          ),
          "0x2f1076cce52e3499f29b804e7d2411b7182c7ecc70d2d7defb7f47d52f6a8787"
        );
      });
    });
  });
});
