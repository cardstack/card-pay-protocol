const web3EthAbi = require("web3-eth-abi");
const gnosisUtils = require("./deprecated-gnosis-utils.js");
const GnosisSafe = artifacts.require("GnosisSafe");
const eventABIs = require("./constant/eventABIs.js");
const { toHex, padLeft, hexToBytes, numberToHex } = require("web3-utils");
const AbiCoder = require("web3-eth-abi");
const { BN } = require("web3-utils");
const {
  network: {
    config: { chainId },
  },
} = require("hardhat");

exports = Object.assign({}, gnosisUtils);

function padZero(addr, prefix = "") {
  return prefix + "000000000000000000000000" + addr.replace("0x", "");
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const signTypedData = async function (account, data) {
  return new Promise(function (resolve, reject) {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "eth_signTypedData_v4",
        params: [account, data],
        id: new Date().getTime(),
      },
      function (err, response) {
        if (err || response.error) {
          return reject(err || response.error);
        }
        resolve(response.result);
      }
    );
  });
};

const encodeMultiSendCall = (txs, multiSend) => {
  const joinedTxs = txs
    .map((tx) =>
      [
        web3EthAbi.encodeParameter("uint8", 0).slice(-2),
        web3EthAbi.encodeParameter("address", tx.to).slice(-40),
        web3EthAbi.encodeParameter("uint256", tx.value).slice(-64),
        web3EthAbi
          .encodeParameter("uint256", web3.utils.hexToBytes(tx.data).length)
          .slice(-64),
        tx.data.replace(/^0x/, ""),
      ].join("")
    )
    .join("");

  const encodedMultiSendCallData = multiSend.contract.methods
    .multiSend(`0x${joinedTxs}`)
    .encodeABI();

  return encodedMultiSendCallData;
};

async function signSafeTransaction(
  to,
  value,
  data,
  operation,
  txGasEstimate,
  baseGasEstimate,
  gasPrice,
  txGasToken,
  refundReceiver,
  nonce,
  owner,
  gnosisSafe
) {
  const typedData = {
    types: {
      // EIP712Domain(uint256 chainId,address verifyingContract)
      EIP712Domain: [
        {
          type: "uint256",
          name: "chainId",
        },
        {
          type: "address",
          name: "verifyingContract",
        },
      ],
      // "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
      SafeTx: [
        {
          type: "address",
          name: "to",
        },
        {
          type: "uint256",
          name: "value",
        },
        {
          type: "bytes",
          name: "data",
        },
        {
          type: "uint8",
          name: "operation",
        },
        {
          type: "uint256",
          name: "safeTxGas",
        },
        {
          type: "uint256",
          name: "baseGas",
        },
        {
          type: "uint256",
          name: "gasPrice",
        },
        {
          type: "address",
          name: "gasToken",
        },
        {
          type: "address",
          name: "refundReceiver",
        },
        {
          type: "uint256",
          name: "nonce",
        },
      ],
    },
    domain: {
      verifyingContract: gnosisSafe.address,
      chainId,
    },
    primaryType: "SafeTx",
    message: {
      to: to,
      value: value,
      data: data,
      operation: operation,
      safeTxGas: txGasEstimate,
      baseGas: baseGasEstimate,
      gasPrice: gasPrice,
      gasToken: txGasToken,
      refundReceiver: refundReceiver,
      nonce: nonce.toNumber(),
    },
  };
  let signatureBytes = "0x";
  signatureBytes += (await signTypedData(owner, typedData)).replace("0x", "");

  return signatureBytes;
}

function getGnosisSafeFromEventLog(receipt, prepaidCardManagerAddr) {
  let cards = getParamsFromEvent(
    receipt,
    eventABIs.CREATE_PREPAID_CARD,
    prepaidCardManagerAddr
  ).map(async (createCardLog) => await GnosisSafe.at(createCardLog.card));
  return Promise.all(cards);
}

const getRewardSafeFromEventLog = async function (receipt, rewardManagerAddr) {
  const rewardSafeCreation = await getParamsFromEvent(
    receipt,
    eventABIs.REWARDEE_REGISTERED,
    rewardManagerAddr
  );

  return GnosisSafe.at(rewardSafeCreation[0].rewardSafe);
};

function isEventMatching(log, topic, address) {
  return log.topics[0] === topic && log.address === address;
}

function getParamsFromEvent(safeResult, event, address) {
  let eventParams = safeResult.receipt.rawLogs
    .filter((log) => isEventMatching(log, event.topic, address))
    .map((log) => web3EthAbi.decodeLog(event.abis, log.data, log.topics));
  return eventParams;
}

// https://docs.gnosis.io/safe/docs/contracts_signatures/
async function rewardEIP1271Signature({
  to,
  value,
  data,
  operation,
  txGasEstimate,
  baseGasEstimate,
  gasPrice,
  txGasToken,
  refundReceiver,
  nonce,
  owner,
  gnosisSafe,
  verifyingContract, //contract which implements isValidSignature() callback
}) {
  let eoaSignature = (
    await signSafeTransaction(
      to,
      value,
      data,
      operation,
      txGasEstimate,
      baseGasEstimate,
      gasPrice,
      txGasToken,
      refundReceiver,
      nonce,
      owner,
      gnosisSafe
    )
  ).replace("0x", "");

  let contractSignature = await createContractSignature(
    gnosisSafe,
    verifyingContract
  );
  let verifyingSignature = await createVerifyingSignature(
    to,
    value,
    data,
    operation,
    txGasEstimate,
    baseGasEstimate,
    gasPrice,
    txGasToken,
    refundReceiver,
    nonce
  );

  const signatures = sortSignatures(
    eoaSignature,
    contractSignature,
    owner,
    verifyingContract.address
  );
  return "0x" + signatures[0] + signatures[1] + verifyingSignature;
}

// https://docs.gnosis.io/safe/docs/contracts_signatures/#contract-signature-eip-1271
async function createContractSignature(gnosisSafe, verifyingContract) {
  const threshold = (await gnosisSafe.getThreshold()).toNumber(); //should be 2
  const address = padLeft(verifyingContract.address, 64).replace("0x", "");
  const dynamicPosition = padLeft(toHex(threshold * 65), 64).replace("0x", "");
  const signatureType = "00";
  return address + dynamicPosition + signatureType;
}

// Signature that is verified within isValidSignature() callback;
// "signature" in the callback -- eip1271 signature
// This signature is custom
// - for reward manager, we found that it was useful to encode ALL parameters of safe transaction
const createVerifyingSignature = function (
  to,
  value,
  data,
  operation,
  safeTxGas,
  baseGas,
  gasPrice,
  gasToken,
  refundReceiver,
  nonce
) {
  const signData = AbiCoder.encodeParameters(
    [
      "address",
      "uint256",
      "bytes",
      "uint8",
      "uint256",
      "uint256",
      "uint256",
      "address",
      "address",
      "uint256",
    ],
    [
      to,
      value,
      data,
      operation,
      safeTxGas,
      baseGas,
      gasPrice,
      gasToken,
      refundReceiver,
      nonce,
    ]
  );
  const verifyingData = padLeft(signData.replace("0x", ""), 64);
  const verifyingDataLength = padLeft(
    numberToHex(hexToBytes(signData).length).replace("0x", ""),
    64
  );
  return verifyingDataLength + verifyingData;
};

function sortSignatures(
  ownerSignature,
  contractSignature,
  safeOwnerAddress,
  contractAddress
) {
  if (safeOwnerAddress.toLowerCase() < contractAddress.toLowerCase()) {
    return [ownerSignature, contractSignature];
  } else {
    return [contractSignature, ownerSignature];
  }
}

// Note: if you have nested gnosis execution, this checks the outer gnosis execution
// Also, it doesn't take into give the gas fee paid by the relayer, only the outer most gnosis execution
const checkGnosisExecution = (safeTx, safeAddress) => {
  const executionSucceeded = getParamsFromEvent(
    safeTx,
    eventABIs.EXECUTION_SUCCESS,
    safeAddress
  );
  const executionFailed = getParamsFromEvent(
    safeTx,
    eventABIs.EXECUTION_FAILURE,
    safeAddress
  );

  return executionFailed.length > 0
    ? { success: false, gasFee: new BN(executionFailed[0].payment) }
    : { success: true, gasFee: new BN(executionSucceeded[0].payment) };
};

const gnosisErrors = {
  SAFE_TRANSACTION_FAILED_WITHOUT_GAS_SET: "GS013",
  INVALID_OWNER_PROVIDED: "GS026",
  SIGNATURES_DATA_TOO_SHORT: "GS020",
  INVALID_CONTRACT_SIGNATURE_PROVIDED: "GS024",
};

Object.assign(exports, {
  ZERO_ADDRESS,
  encodeMultiSendCall,
  signSafeTransaction,
  getGnosisSafeFromEventLog,
  getRewardSafeFromEventLog,
  getParamsFromEvent,
  padZero,
  signTypedData,
  rewardEIP1271Signature,
  checkGnosisExecution,
  gnosisErrors,
});

module.exports = exports;
