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
      "CreatePrepaidCard(address,address,address,address,uint256,uint256,uint256,string)"
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
        type: "address",
        name: "createdFromDepot",
      },
      {
        type: "uint256",
        name: "issuingTokenAmount",
      },
      {
        type: "uint256",
        name: "spendAmount",
      },
      {
        type: "uint256",
        name: "gasFeeCollected",
      },
      {
        type: "string",
        name: "customizationDID",
      },
    ],
  },
  SUPPLIER_SAFE_CREATED: {
    topic: web3EthAbi.encodeEventSignature(
      "SupplierSafeCreated(address,address)"
    ),
    abis: [
      {
        type: "address",
        name: "supplier",
      },
      {
        type: "address",
        name: "safe",
      },
    ],
  },
  MERCHANT_CREATION: {
    topic: web3EthAbi.encodeEventSignature(
      "MerchantCreation(address,address,string)"
    ),
    abis: [
      {
        type: "address",
        name: "merchant",
      },
      {
        type: "address",
        name: "merchantSafe",
      },
      {
        type: "string",
        name: "infoDID",
      },
    ],
  },
  SET_PREPAID_CARD_INVENTORY: {
    topic: web3EthAbi.encodeEventSignature(
      "ItemSet(address,address,address,uint256,string,bytes32)"
    ),
    abis: [
      {
        type: "address",
        name: "prepaidCard",
      },
      {
        type: "address",
        name: "issuer",
      },
      {
        type: "address",
        name: "issuingToken",
      },
      {
        type: "uint256",
        name: "faceValue",
      },
      {
        type: "string",
        name: "customizationDID",
      },
      {
        type: "bytes32",
        name: "sku",
      },
    ],
  },
  REMOVE_PREPAID_CARD_INVENTORY: {
    topic: web3EthAbi.encodeEventSignature(
      "ItemRemoved(address,address,bytes32)"
    ),
    abis: [
      {
        type: "address",
        name: "prepaidCard",
      },
      {
        type: "address",
        name: "issuer",
      },
      {
        type: "bytes32",
        name: "sku",
      },
    ],
  },
  SET_PREPAID_CARD_ASK: {
    topic: web3EthAbi.encodeEventSignature(
      "AskSet(address,address,bytes32,uint256)"
    ),
    abis: [
      {
        type: "address",
        name: "issuer",
      },
      {
        type: "address",
        name: "issuingToken",
      },
      {
        type: "bytes32",
        name: "sku",
      },
      {
        type: "uint256",
        name: "askPrice",
      },
    ],
  },
  PROVISION_PREPAID_CARD: {
    topic: web3EthAbi.encodeEventSignature(
      "ProvisionedPrepaidCard(address,address,bytes32,uint256)"
    ),
    abis: [
      {
        type: "address",
        name: "prepaidCard",
      },
      {
        type: "address",
        name: "customer",
      },
      {
        type: "bytes32",
        name: "sku",
      },
      {
        type: "uint256",
        name: "askPrice",
      },
    ],
  },
  REWARDEE_REGISTERED: {
    topic: web3EthAbi.encodeEventSignature(
      "RewardeeRegistered(address,address,address)"
    ),
    abis: [
      {
        type: "address",
        name: "rewardProgramID",
      },
      {
        type: "address",
        name: "rewardee",
      },
      {
        type: "address",
        name: "rewardSafe",
      },
    ],
  },
  REWARDEE_CLAIM: {
    topic: web3EthAbi.encodeEventSignature(
      "RewardeeClaim(address,address,address,address,uint256,bytes)"
    ),
    abis: [
      {
        type: "address",
        name: "rewardProgramID",
      },
      {
        type: "address",
        name: "rewardee",
      },
      {
        type: "address",
        name: "rewardSafe",
      },
      {
        type: "address",
        name: "token",
      },
      {
        type: "uint256",
        name: "amount",
      },
      {
        type: "bytes",
        name: "leaf",
      },
    ],
  },
  REWARD_SAFE_WITHDRAWAL: {
    topic: web3EthAbi.encodeEventSignature(
      "RewardSafeWithdrawal(address,address,uint256)"
    ),
    abis: [
      {
        type: "address",
        name: "rewardSafe",
      },
      {
        type: "address",
        name: "token",
      },
      {
        type: "uint256",
        name: "value",
      },
    ],
  },
  REWARD_SAFE_TRANSFER: {
    topic: web3EthAbi.encodeEventSignature(
      "RewardSafeTransferred(address,address,address)"
    ),
    abis: [
      {
        type: "address",
        name: "rewardSafe",
      },
      {
        type: "address",
        name: "oldOwner",
      },
      {
        type: "address",
        name: "newOwner",
      },
    ],
  },
  PREPAID_CARD_MARKET_V2_DEPOSIT_TOKENS: {
    topic: web3EthAbi.encodeEventSignature(
      "TokensDeposited(address,uint256,address,address)"
    ),
    abis: [
      {
        type: "address",
        name: "issuer",
      },
      {
        type: "uint256",
        name: "amount",
      },
      {
        type: "address",
        name: "token",
      },
      {
        type: "address",
        name: "safe",
      },
    ],
  },
  PREPAID_CARD_MARKET_V2_TOKENS_WITHDRAWN: {
    topic: web3EthAbi.encodeEventSignature(
      "TokensWithdrawn(address,address,address,uint256)"
    ),
    abis: [
      {
        type: "address",
        name: "safe",
      },
      {
        type: "address",
        name: "issuer",
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
  PREPAID_CARD_MARKET_V2_SKU_ADDED: {
    topic: web3EthAbi.encodeEventSignature(
      "SkuAdded(address,address,uint256,string,bytes32)"
    ),
    abis: [
      {
        type: "address",
        name: "issuer",
      },
      {
        type: "address",
        name: "token",
      },
      {
        type: "uint256",
        name: "faceValue",
      },
      {
        type: "string",
        name: "customizationDID",
      },
      {
        type: "bytes32",
        name: "sku",
      },
    ],
  },
  PREPAID_CARD_MARKET_V2_ASK_SET: {
    topic: web3EthAbi.encodeEventSignature(
      "AskSet(address,address,bytes32,uint256)"
    ),
    abis: [
      {
        type: "address",
        name: "issuer",
      },
      {
        type: "address",
        name: "issuingToken",
      },
      {
        type: "bytes32",
        name: "sku",
      },
      {
        type: "uint256",
        name: "askPrice",
      },
    ],
  },
};

module.exports = eventABIs;
