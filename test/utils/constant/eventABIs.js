const web3EthAbi = require("web3-eth-abi");

const eventABIs = {
  EXECUTION_SUCCESS: {
    topic: web3EthAbi.encodeEventSignature("ExecutionSuccess(bytes32,uint256)"),
    abis: [
      {
        type: "bytes32",
        name: "txHash",
      },
      {
        type: "uint256",
        name: "payment",
      },
    ],
  },
  EXECUTION_FAILURE: {
    topic: web3EthAbi.encodeEventSignature("ExecutionFailure(bytes32,uint256)"),
    abis: [
      {
        type: "bytes32",
        name: "txHash",
      },
      {
        type: "uint256",
        name: "payment",
      },
    ],
  },
  CREATE_PREPAID_CARD: {
    topic: web3EthAbi.encodeEventSignature(
      "CreatePrepaidCard(address,address,address,uint256)"
    ),
    abis: [
      {
        type: "address",
        name: "issuer",
      },
      {
        type: "address",
        name: "card",
      },
      {
        type: "address",
        name: "token",
      },
      {
        type: "uint256",
        name: "amount",
      },
    ],
  },
  MERCHANT_CREATION: {
    topic: web3EthAbi.encodeEventSignature("MerchantCreation(address,address)"),
    abis: [
      {
        type: "address",
        name: "merchant",
      },
      {
        type: "address",
        name: "merchantSafe",
      },
    ],
  },
  MERCHANT_UPDATE: {
    topic: web3EthAbi.encodeEventSignature("MerchantUpdate(address,address)"),
    abis: [
      {
        type: "address",
        name: "merchant",
      },
      {
        type: "address",
        name: "merchantSafe",
      },
    ],
  },
};

module.exports = eventABIs;
