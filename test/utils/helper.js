const AbiCoder = require("web3-eth-abi");
const { toBN } = require("web3-utils");

const { signSafeTransaction, ZERO_ADDRESS } = require("./general");

exports.shouldBeSameBalance = async function (token, address, amount) {
  await token.balanceOf(address).should.eventually.be.a.bignumber.equal(amount);
};

exports.getBalance = async function (token, account) {
  let currentBalance = await token.balanceOf(account);
  return toBN(currentBalance);
};

exports.toTokenUnit = (_numberToken, _decimals = 18) => {
  let dec = toBN("10").pow(toBN(_decimals));
  let number = toBN(_numberToken);
  return number.mul(dec);
};

function packExecutionData({
  to,
  value = 0,
  data,
  operation = 0,
  txGasEstimate = 0,
  baseGasEstimate = 0,
  gasPrice = 0,
  txGasToken = ZERO_ADDRESS,
  refundReceive = ZERO_ADDRESS,
}) {
  return {
    to,
    value,
    data,
    operation,
    txGasEstimate,
    baseGasEstimate,
    gasPrice,
    txGasToken,
    refundReceive,
  };
}

exports.packExecutionData = packExecutionData;

exports.amountOf = (_numberToken, _decimals = 18) => {
  let dec = toBN("10").pow(toBN(_decimals));
  let number = toBN(_numberToken);
  return number.mul(dec);
};

exports.getTotalSupply = async (token) => {
  return token.totalSupply();
};
exports.encodeCreateCardsData = function (account, amounts = []) {
  return AbiCoder.encodeParameters(
    ["address", "uint256[]"],
    [account, amounts]
  );
};

exports.signAndSendSafeTransaction = async function signAndSendSafeTransaction(
  safeTxData = {
    to,
    value,
    data,
    operation,
    txGasEstimate,
    baseGasEstimate,
    gasPrice,
    txGasToken,
    refundReceiver,
  },
  owner,
  gnosisSafe,
  relayer,
  options = null
) {
  let packData = packExecutionData(safeTxData);

  let safeTxArr = Object.keys(packData).map((key) => packData[key]);

  let nonce = await gnosisSafe.nonce();
  // sign data with nonce by owner and gnosisSafe
  let signature = await signSafeTransaction(
    ...safeTxArr,
    nonce,
    owner,
    gnosisSafe
  );

  // compute txHash of transaction
  let safeTxHash = await gnosisSafe.getTransactionHash(...safeTxArr, nonce);
  let safeTx;
  if (!options) {
    safeTx = await gnosisSafe.execTransaction(...safeTxArr, signature, {
      from: relayer,
    });
  } else {
    safeTx = await gnosisSafe.execTransaction(...safeTxArr, signature, {
      from: relayer,
      ...options,
    });
  }

  return {
    safeTxHash,
    safeTx,
  };
};
