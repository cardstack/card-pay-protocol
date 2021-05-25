const GnosisSafe = artifacts.require("GnosisSafe");
const ChainlinkOracle = artifacts.require("ChainlinkFeedAdapter");
const MockDIAOracle = artifacts.require("MockDIAOracle");
const DIAPriceOracle = artifacts.require("DIAOracleAdapter");
const Feed = artifacts.require("ManualFeed");
const ERC677Token = artifacts.require("ERC677Token.sol");
const AbiCoder = require("web3-eth-abi");
const { toBN } = require("web3-utils");
const { TOKEN_DETAIL_DATA } = require("../setup");
const eventABIs = require("./constant/eventABIs");

const {
  getParamsFromEvent,
  getParamFromTxEvent,
  signSafeTransaction,
  ZERO_ADDRESS,
  getGnosisSafeFromEventLog,
} = require("./general");

function toTokenUnit(_numberToken, _decimals = 18) {
  let dec = toBN("10").pow(toBN(_decimals));
  let number = toBN(_numberToken);
  return number.mul(dec);
}

function encodeCreateCardsData(account, amounts = []) {
  return AbiCoder.encodeParameters(
    ["address", "uint256[]"],
    [account, amounts]
  );
}

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

async function signAndSendSafeTransaction(
  safeTxData,
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
}
async function payMerchant(
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  gasToken,
  relayer,
  customerAddress,
  merchantSafe,
  amount
) {
  let data = await prepaidCardManager.getPayData(
    issuingToken.address,
    merchantSafe,
    amount
  );

  let signature = await signSafeTransaction(
    issuingToken.address,
    0,
    data,
    0,
    0,
    0,
    0,
    gasToken.address,
    prepaidCard.address,
    await prepaidCard.nonce(),
    customerAddress,
    prepaidCard
  );

  let signatures = await prepaidCardManager.appendPrepaidCardAdminSignature(
    customerAddress,
    signature
  );

  return await prepaidCardManager.payForMerchant(
    prepaidCard.address,
    issuingToken.address,
    merchantSafe,
    amount,
    signatures,
    { from: relayer }
  );
}

exports.toTokenUnit = toTokenUnit;
exports.encodeCreateCardsData = encodeCreateCardsData;
exports.packExecutionData = packExecutionData;
exports.signAndSendSafeTransaction = signAndSendSafeTransaction;
exports.payMerchant = payMerchant;

exports.shouldBeSameBalance = async function (token, address, amount) {
  await token.balanceOf(address).should.eventually.be.a.bignumber.equal(amount);
};

exports.getBalance = async function (token, account) {
  let currentBalance = await token.balanceOf(account);
  return toBN(currentBalance);
};

exports.amountOf = (_numberToken, _decimals = 18) => {
  let dec = toBN("10").pow(toBN(_decimals));
  let number = toBN(_numberToken);
  return number.mul(dec);
};

exports.getTotalSupply = async (token) => {
  return token.totalSupply();
};

exports.setupExchanges = async function (owner) {
  let daicpxdToken = await ERC677Token.new();
  await daicpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);

  let cardcpxdToken = await ERC677Token.new();
  await cardcpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);

  let daiFeed = await Feed.new();
  await daiFeed.initialize(owner);
  await daiFeed.setup("DAI.CPXD", 8);
  await daiFeed.addRound(100000000, 1618433281, 1618433281);
  let ethFeed = await Feed.new();
  await ethFeed.initialize(owner);
  await ethFeed.setup("ETH", 8);
  await ethFeed.addRound(300000000000, 1618433281, 1618433281);
  let chainlinkOracle = await ChainlinkOracle.new();
  chainlinkOracle.initialize(owner);
  await chainlinkOracle.setup(
    daiFeed.address,
    ethFeed.address,
    daiFeed.address
  );
  let mockDiaOracle = await MockDIAOracle.new();
  await mockDiaOracle.initialize(owner);
  await mockDiaOracle.setValue("CARD/USD", 1000000, 1618433281);
  let diaPriceOracle = await DIAPriceOracle.new();
  await diaPriceOracle.initialize(owner);
  await diaPriceOracle.setup(mockDiaOracle.address, "CARD", daiFeed.address);
  return {
    daicpxdToken,
    cardcpxdToken,
    chainlinkOracle,
    diaPriceOracle,
    daiFeed,
    ethFeed,
    mockDiaOracle,
  };
};

exports.createDepotSafe = async function (
  gnosisSafeMasterCopy,
  proxyFactory,
  issuer
) {
  let gnosisData = gnosisSafeMasterCopy.contract.methods
    .setup(
      [issuer],
      1,
      ZERO_ADDRESS,
      "0x",
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      0,
      ZERO_ADDRESS
    )
    .encodeABI();

  let depot = await getParamFromTxEvent(
    await proxyFactory.createProxy(gnosisSafeMasterCopy.address, gnosisData),
    "ProxyCreation",
    "proxy",
    proxyFactory.address,
    GnosisSafe,
    "create Gnosis Safe Proxy"
  );
  return depot;
};

exports.createDepotFromBridgeUtils = async function (
  bridgeUtils,
  mediatorBridgeAddress,
  issuer
) {
  let summary = await bridgeUtils.registerSupplier(issuer, {
    from: mediatorBridgeAddress,
  });

  let depot = summary.receipt.logs[0].args[1];
  return await GnosisSafe.at(depot);
};

exports.createPrepaidCards = async function (
  depot,
  prepaidCardManager,
  issuingToken,
  gasToken,
  issuer,
  relayer,
  amounts,
  amountToSend
) {
  let createCardData = encodeCreateCardsData(
    issuer,
    amounts.map((amount) =>
      typeof amount === "string" ? amount : amount.toString()
    )
  );

  if (amountToSend == null) {
    amountToSend = toBN("0");
    amounts.forEach((amount) => (amountToSend = amountToSend.add(amount)));
  }

  let payloads = issuingToken.contract.methods
    .transferAndCall(prepaidCardManager.address, amountToSend, createCardData)
    .encodeABI();

  // Note that when there is a revert--the revert will happen here, presumably
  // we could skip this estimate and just guess then the revert will result in a
  // Gnosis ExecutionFailure event being fired. I think it's fine to just let
  // this explode with the revert code, otherwise we'll just end up testing the
  // gnosis machinery, since the same revert will be triggered--just farther
  // downstream and more opaquely
  let gasEstimate = await issuingToken.contract.methods
    .transferAndCall(prepaidCardManager.address, amountToSend, createCardData)
    .estimateGas();

  let safeTxData = {
    to: issuingToken.address,
    data: payloads,
    txGasEstimate: gasEstimate,
    gasPrice: 1000000000,
    txGasToken: gasToken.address,
    refundReceive: relayer,
  };

  let { safeTxHash, safeTx } = await signAndSendSafeTransaction(
    safeTxData,
    issuer,
    depot,
    relayer
  );
  let executionResult;
  executionResult = getParamsFromEvent(
    safeTx,
    eventABIs.EXECUTION_SUCCESS,
    depot.address
  );

  let executionSucceeded = executionResult[0].txHash === safeTxHash;

  let paymentActual = toBN(executionResult[0]["payment"]);
  let prepaidCards = [];
  prepaidCards = await getGnosisSafeFromEventLog(
    safeTx,
    prepaidCardManager.address
  );

  return {
    safeTx,
    safeTxHash,
    paymentActual, // the amount that was charged to the depot including gas fees
    prepaidCards,
    executionSucceeded,
  };
};

exports.transferOwner = async function (
  prepaidCardManager,
  prepaidCard,
  oldOwner,
  newOwner,
  relayer
) {
  let xferData = [prepaidCard.address, oldOwner, newOwner];
  let packData = packExecutionData({
    to: prepaidCard.address,
    data: await prepaidCardManager.getSellCardData(oldOwner, newOwner),
  });
  let safeTxArr = Object.keys(packData).map((key) => packData[key]);
  let signature = await signSafeTransaction(
    ...safeTxArr,
    await prepaidCard.nonce(),
    oldOwner,
    prepaidCard
  );

  await prepaidCardManager.sellCard(
    ...xferData,
    await prepaidCardManager.appendPrepaidCardAdminSignature(
      oldOwner,
      signature
    ),
    { from: relayer }
  );
};

exports.registerMerchant = async function (
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  gasToken,
  relayer,
  merchant,
  amount
) {
  return await payMerchant(
    prepaidCardManager,
    prepaidCard,
    issuingToken,
    gasToken,
    relayer,
    merchant,
    ZERO_ADDRESS,
    amount
  );
};
