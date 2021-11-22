const MerkleTree = require("./merkle-tree");
const AbiCoder = require("web3-eth-abi");

class PaymentTree extends MerkleTree {
  constructor(paymentList) {
    super(paymentList);
    this.paymentNodes = paymentList;
  }

  getLeaf(node) {
    let transferData = null;
    if (node["tokenType"] == 0) {
      transferData = AbiCoder.encodeParameters(
        ["string"],
        [node["data"].toString()]
      );
    } else if (node["tokenType"] == 1) {
      transferData = AbiCoder.encodeParameters(
        ["address", "uint256"],
        [node["token"], node["amount"]]
      );
    } else if (node["tokenType"] == 2) {
      transferData = AbiCoder.encodeParameters(
        ["address", "uint256"],
        [node["token"], node["amount"]]
      );
    }

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
        transferData,
      ]
    );
  }
}

module.exports = PaymentTree;
