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
    super(paymentList);
    this.paymentNodes = paymentList;
  }
}

module.exports = CumulativePaymentTree;
