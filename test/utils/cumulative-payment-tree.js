const MerkleTree = require("./merkle-tree");
const { bufferToHex, zeros } = require("ethereumjs-util");
const _ = require("lodash");

/*
 * `paymentList` is an array of objects that have a property `payee` to hold the
 * payee's Ethereum address and `amount` to hold the cumulative amount of tokens
 * paid to the payee across all payment cycles:
 *
 * [{
 *   payee: "0x627306090abab3a6e1400e9345bc60c78a8bef57",
 *   amount: 20
 * },{
 *   payee: "0xf17f52151ebef6c7334fad080c5704d77216b732",
 *   amount: 12
 * },{
 *   payee: "0xc5fdf4076b8f3a5357c5e395ab970b5b54098fef",
 *   amount: 15
 * }]
 *
 */

class CumulativePaymentTree extends MerkleTree {
  constructor(paymentList) {
    let filteredPaymentList = paymentList.filter(
      (payment) => payment.payee && payment.amount && payment.token
    );
    const o = {};
    let reducedPaymentList = filteredPaymentList.reduce(function (r, e) {
      const key = e.token + "|" + e.payee;
      if (!o[key]) {
        o[key] = e;
        r.push(o[key]);
      } else {
        o[key].amount = o[key].amount.add(e.amount); //using bn
      }
      return r;
    }, []);

    super(reducedPaymentList);
    this.paymentNodes = reducedPaymentList;
  }

  amountForPayee(payee, token) {
    let payment = _.find(this.paymentNodes, { payee, token });
    if (!payment) {
      return 0;
    }

    return payment.amount;
  }

  hexProofForPayee(payee, token, paymentCycle) {
    let leaf = _.find(this.paymentNodes, { payee, token });

    // find a better way to check this
    if (!leaf) {
      return bufferToHex(zeros(32));
    }
    return this.getHexProof(leaf, [
      paymentCycle,
      this.amountForPayee(payee, token),
    ]);
  }

  withdrawData(payee, paymentCycle) {
    let leaves = _.filter(this.paymentNodes, { payee });
    return leaves.map((leaf) => {
      return {
        ...leaf,
        proof: this.hexProofForPayee(payee, leaf.token, paymentCycle),
      };
    });
  }
}

module.exports = CumulativePaymentTree;
