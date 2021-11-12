const MerkleTree = require("./merkle-tree");
const AbiCoder = require("web3-eth-abi");

class PaymentTree extends MerkleTree {
  constructor(paymentList) {
    super(paymentList);
    this.paymentNodes = paymentList;
  }

  getLeaf(node) {
    return AbiCoder.encodeParameters(
      [
        "address",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "address",
        "bytes",
      ],
      [
        node["rewardProgramID"],
        node["paymentCycleNumber"],
        node["startBlock"],
        node["endBlock"],
        node["tokenType"],
        node["payee"],
        AbiCoder.encodeParameters(
          ["address", "uint256"],
          [node["token"], node["amount"]]
        ),
      ]
    );
  }
}

module.exports = PaymentTree;
