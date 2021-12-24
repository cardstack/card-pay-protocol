const util = require("util");
const solc = require("solc");
const lightwallet = require("eth-lightwallet");
const abi = require("ethereumjs-abi");
const { assert } = require("chai");

async function getParamFromTxEvent(
  transaction,
  eventName,
  paramName,
  contract,
  contractFactory,
  subject
) {
  assert.isObject(transaction);
  if (subject != null) {
    logGasUsage(subject, transaction);
  }
  let logs = transaction.logs;
  if (eventName != null) {
    logs = logs.filter((l) => l.event === eventName && l.address === contract);
  }
  assert.equal(logs.length, 1, "too many logs found!");
  let param = logs[0].args[paramName];
  if (contractFactory != null) {
    let contract = await contractFactory.at(param);
    assert.isObject(contract, `getting ${paramName} failed for ${param}`);
    return contract;
  } else {
    return param;
  }
}

function checkTxEvent(transaction, eventName, contract, exists, subject) {
  assert.isObject(transaction);
  if (subject && subject != null) {
    logGasUsage(subject, transaction);
  }
  let logs = transaction.logs;
  if (eventName != null) {
    logs = logs.filter((l) => l.event === eventName && l.address === contract);
  }
  assert.equal(
    logs.length,
    exists ? 1 : 0,
    exists ? "event was not present" : "event should not be present"
  );
  return exists ? logs[0] : null;
}

function logGasUsage(subject, transactionOrReceipt) {
  let receipt = transactionOrReceipt.receipt || transactionOrReceipt;
  console.log("    Gas costs for " + subject + ": " + receipt.gasUsed);
}

async function deployContract(subject, contract) {
  let deployed = await contract.new();
  let receipt = await web3.eth.getTransactionReceipt(deployed.transactionHash);
  logGasUsage(subject, receipt);
  return deployed;
}

function signTransaction(lw, signers, transactionHash) {
  let signatureBytes = "0x";
  signers.sort();
  for (var i = 0; i < signers.length; i++) {
    let sig = lightwallet.signing.signMsgHash(
      lw.keystore,
      lw.passwords,
      transactionHash,
      signers[i]
    );
    signatureBytes +=
      sig.r.toString("hex") + sig.s.toString("hex") + sig.v.toString(16);
  }
  return signatureBytes;
}

async function compile(source) {
  var input = JSON.stringify({
    language: "Solidity",
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
    sources: {
      "tmp.sol": {
        content: source,
      },
    },
  });
  let solcData = await solc.compile(input);
  let output = JSON.parse(solcData);
  if (!output["contracts"]) {
    console.log(output);
    throw Error("Could not compile contract");
  }
  let fileOutput = output["contracts"]["tmp.sol"];
  let contractOutput = fileOutput[Object.keys(fileOutput)[0]];
  let interface = contractOutput["abi"];
  let data = "0x" + contractOutput["evm"]["bytecode"]["object"];
  return {
    data: data,
    interface: interface,
  };
}

Object.assign(exports, {
  compile,
  deployContract,
  getParamFromTxEvent,
  checkTxEvent,
  logGasUsage,
  signTransaction,
});
