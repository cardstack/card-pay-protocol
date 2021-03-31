const gnosisUtils = require("@gnosis.pm/safe-contracts/test/utils/general");
const web3EthAbi = require("web3-eth-abi");
const GnosisSafe = artifacts.require("GnosisSafe");
const eventABIs = require("./constant/eventABIs.js");

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
        method: "eth_signTypedData",
        params: [account, data],
        id: new Date().getTime(),
      },
      function (err, response) {
        if (err) {
          return reject(err);
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
      EIP712Domain: [
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

function isEventMatching(log, topic, address) {
  return log.topics[0] === topic && log.address === address;
}

function getParamsFromEvent(safeResult, event, address) {
  let eventParams = safeResult.receipt.rawLogs
    .filter((log) => isEventMatching(log, event.topic, address))
    .map((log) => web3EthAbi.decodeLog(event.abis, log.data, log.topics));
  return eventParams;
}

Object.assign(exports, {
  ZERO_ADDRESS,
  encodeMultiSendCall,
  signSafeTransaction,
  getGnosisSafeFromEventLog,
  getParamsFromEvent,
  padZero,
});

module.exports = exports;
