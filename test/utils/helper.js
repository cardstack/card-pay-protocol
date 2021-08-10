const GnosisSafe = artifacts.require("GnosisSafe");
const ChainlinkOracle = artifacts.require("ChainlinkFeedAdapter");
const MockDIAOracle = artifacts.require("MockDIAOracle");
const DIAPriceOracle = artifacts.require("DIAOracleAdapter");
const Feed = artifacts.require("ManualFeed");
const ERC677Token = artifacts.require("ERC677Token.sol");
const AbiCoder = require("web3-eth-abi");
const Exchange = artifacts.require("Exchange");

const PayMerchantHandler = artifacts.require("PayMerchantHandler");
const RegisterMerchantHandler = artifacts.require("RegisterMerchantHandler");
const SplitPrepaidCardHandler = artifacts.require("SplitPrepaidCardHandler");
const TransferPrepaidCardHandler = artifacts.require(
  "TransferPrepaidCardHandler"
);
const RegisterRewardeeHandler = artifacts.require("RegisterRewardeeHandler");
const RegisterRewardProgramHandler = artifacts.require(
  "RegisterRewardProgramHandler"
);
const LockRewardProgramHandler = artifacts.require("LockRewardProgramHandler");
const AddRewardRuleHandler = artifacts.require("AddRewardRuleHandler");
const RemoveRewardRuleHandler = artifacts.require("RemoveRewardRuleHandler");
const UpdateRewardProgramAdminHandler = artifacts.require(
  "UpdateRewardProgramAdminHandler"
);

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

function encodeCreateCardsData(
  account,
  issuingTokenAmounts = [],
  spendAmounts = [],
  customizationDID = ""
) {
  return AbiCoder.encodeParameters(
    ["address", "uint256[]", "uint256[]", "string"],
    [account, issuingTokenAmounts, spendAmounts, customizationDID]
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

exports.findAccountBeforeAddress = (accounts, address) => {
  for (let account of accounts) {
    if (account.toLowerCase() < address.toLowerCase()) {
      return account;
    }
  }
  throw new Error(
    `Could not find an account address that is lexigraphically before the address ${address} from ${accounts.length} possibilities. Make sure you are using ganache (yarn ganache:start) to run your private chain and try increasing the number of accounts to test with.`
  );
};

exports.findAccountAfterAddress = (accounts, address) => {
  for (let account of accounts) {
    if (account.toLowerCase() > address.toLowerCase()) {
      return account;
    }
  }
  throw new Error(
    `Could not find an account address that is lexigraphically after the address ${address} from ${accounts.length} possibilities. Make sure you are using ganache (yarn ganache:start) to run your private chain and try increasing the number of accounts to test with.`
  );
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

  let exchange = await Exchange.new();
  await exchange.initialize(owner);
  await exchange.setup(1000000); // this is a 1% rate margin drift
  await exchange.createExchange("DAI", chainlinkOracle.address);
  await exchange.createExchange("CARD", diaPriceOracle.address);

  return {
    exchange,
    daicpxdToken,
    cardcpxdToken,
    chainlinkOracle,
    diaPriceOracle,
    daiFeed,
    ethFeed,
    mockDiaOracle,
  };
};

exports.addActionHandlers = async function (
  prepaidCardManager,
  revenuePool,
  actionDispatcher,
  merchantManager,
  tokenManager,
  rewardManager,
  owner,
  exchangeAddress,
  spendAddress
) {
  let payMerchantHandler = await PayMerchantHandler.new();
  await payMerchantHandler.initialize(owner);
  await payMerchantHandler.setup(
    actionDispatcher.address,
    merchantManager.address,
    prepaidCardManager.address,
    revenuePool.address,
    spendAddress,
    tokenManager.address
  );

  let registerMerchantHandler = await RegisterMerchantHandler.new();
  await registerMerchantHandler.initialize(owner);
  await registerMerchantHandler.setup(
    actionDispatcher.address,
    merchantManager.address,
    prepaidCardManager.address,
    revenuePool.address,
    exchangeAddress,
    tokenManager.address
  );

  let splitPrepaidCardHandler = await SplitPrepaidCardHandler.new();
  await splitPrepaidCardHandler.initialize(owner);
  await splitPrepaidCardHandler.setup(
    actionDispatcher.address,
    prepaidCardManager.address,
    tokenManager.address
  );

  let transferPrepaidCardHandler = await TransferPrepaidCardHandler.new();
  await transferPrepaidCardHandler.initialize(owner);
  await transferPrepaidCardHandler.setup(
    actionDispatcher.address,
    prepaidCardManager.address,
    tokenManager.address
  );
  let registerRewardeeHandler = await RegisterRewardeeHandler.new();
  await registerRewardeeHandler.initialize(owner);

  await registerRewardeeHandler.setup(
    actionDispatcher.address,
    prepaidCardManager.address,
    exchangeAddress,
    tokenManager.address,
    rewardManager.address
  );

  let registerRewardProgramHandler = await RegisterRewardProgramHandler.new();
  await registerRewardProgramHandler.initialize(owner);
  await registerRewardProgramHandler.setup(
    actionDispatcher.address,
    exchangeAddress,
    tokenManager.address,
    rewardManager.address
  );

  let lockRewardProgramHandler = await LockRewardProgramHandler.new();
  await lockRewardProgramHandler.initialize(owner);
  await lockRewardProgramHandler.setup(
    actionDispatcher.address,
    prepaidCardManager.address,
    exchangeAddress,
    tokenManager.address,
    rewardManager.address
  );

  let addRewardRuleHandler = await AddRewardRuleHandler.new();
  await addRewardRuleHandler.initialize(owner);
  await addRewardRuleHandler.setup(
    actionDispatcher.address,
    prepaidCardManager.address,
    exchangeAddress,
    tokenManager.address,
    rewardManager.address
  );
  let removeRewardRuleHandler = await RemoveRewardRuleHandler.new();
  await removeRewardRuleHandler.initialize(owner);
  await removeRewardRuleHandler.setup(
    actionDispatcher.address,
    prepaidCardManager.address,
    exchangeAddress,
    tokenManager.address,
    rewardManager.address
  );
  let updateRewardProgramAdminHandler = await UpdateRewardProgramAdminHandler.new();
  await updateRewardProgramAdminHandler.initialize(owner);
  await updateRewardProgramAdminHandler.setup(
    actionDispatcher.address,
    prepaidCardManager.address,
    exchangeAddress,
    tokenManager.address,
    rewardManager.address
  );

  await actionDispatcher.addHandler(payMerchantHandler.address, "payMerchant");
  await actionDispatcher.addHandler(splitPrepaidCardHandler.address, "split");
  await actionDispatcher.addHandler(
    transferPrepaidCardHandler.address,
    "transfer"
  );
  await actionDispatcher.addHandler(
    registerMerchantHandler.address,
    "registerMerchant"
  );
  await actionDispatcher.addHandler(
    registerRewardeeHandler.address,
    "registerRewardee"
  );
  await actionDispatcher.addHandler(
    registerRewardProgramHandler.address,
    "registerRewardProgram"
  );
  await actionDispatcher.addHandler(
    lockRewardProgramHandler.address,
    "lockRewardProgram"
  );
  await actionDispatcher.addHandler(
    addRewardRuleHandler.address,
    "addRewardRule"
  );
  await actionDispatcher.addHandler(
    removeRewardRuleHandler.address,
    "removeRewardRule"
  );
  await actionDispatcher.addHandler(
    updateRewardProgramAdminHandler.address,
    "updateRewardProgramAdmin"
  );
  return {
    payMerchantHandler,
    registerMerchantHandler,
    splitPrepaidCardHandler,
    transferPrepaidCardHandler,
    registerRewardeeHandler,
    registerRewardProgramHandler,
    lockRewardProgramHandler,
    addRewardRuleHandler,
    removeRewardRuleHandler,
    updateRewardProgramAdminHandler,
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

exports.createDepotFromSupplierMgr = async function (supplierManager, issuer) {
  let tx = await supplierManager.registerSupplier(issuer);

  let eventParams = getParamsFromEvent(
    tx,
    eventABIs.SUPPLIER_SAFE_CREATED,
    supplierManager.address
  );
  let depot = eventParams[0].safe;
  return await GnosisSafe.at(depot);
};

const createPrepaidCards = async function (
  depot,
  prepaidCardManager,
  issuingToken,
  gasToken,
  issuer,
  relayer,
  issuingTokenAmounts,
  amountToSend,
  customizationDID
) {
  let createCardData = encodeCreateCardsData(
    issuer,
    issuingTokenAmounts.map((amount) =>
      typeof amount === "string" ? amount : amount.toString()
    ),
    issuingTokenAmounts.map((amount) =>
      typeof amount === "string" ? amount : amount.toString()
    ),
    customizationDID
  );

  if (amountToSend == null) {
    amountToSend = toBN("0");
    issuingTokenAmounts.forEach(
      (amount) => (amountToSend = amountToSend.add(amount))
    );
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

const transferOwner = async function (
  prepaidCardManager,
  prepaidCard,
  oldOwner,
  newOwner,
  gasToken,
  relayer,
  issuingToken
) {
  let usdRate = 100000000; // 1 DAI = 1 USD
  let packData = packExecutionData({
    to: prepaidCard.address,
    txGasToken: gasToken.address,
    data: await prepaidCardManager.getTransferCardData(
      prepaidCard.address,
      newOwner
    ),
  });
  let safeTxArr = Object.keys(packData).map((key) => packData[key]);
  let nonce = await prepaidCard.nonce();
  let previousOwnerSignature = await signSafeTransaction(
    ...safeTxArr,
    // the quirk here is that we are signing this txn in advance so we need to
    // optimistically advance the nonce by 1 to account for the fact that we are
    // executing the "send" action before this one.
    nonce.add(toBN("1")),
    oldOwner,
    prepaidCard
  );
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    0,
    usdRate,
    "transfer",
    AbiCoder.encodeParameters(
      ["address", "bytes"],
      [newOwner, previousOwnerSignature]
    )
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
    ZERO_ADDRESS,
    nonce,
    oldOwner,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    0,
    usdRate,
    "transfer",
    AbiCoder.encodeParameters(
      ["address", "bytes"],
      [newOwner, previousOwnerSignature]
    ),
    signature,
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
  spendAmount,
  usdRate,
  infoDID = ""
) {
  if (usdRate == null) {
    usdRate = 100000000; // 1 DAI = 1 USD
  }
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    "registerMerchant",
    AbiCoder.encodeParameters(["string"], [infoDID])
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
    merchant,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    "registerMerchant",
    AbiCoder.encodeParameters(["string"], [infoDID]),
    signature,
    { from: relayer }
  );
};

exports.splitPrepaidCard = async function (
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  relayer,
  issuer,
  spendAmount,
  issuingTokenAmounts,
  customizationDID,
  usdRate
) {
  if (usdRate == null) {
    usdRate = 100000000; // 1 DAI = 1 USD
  }
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    "split",
    AbiCoder.encodeParameters(
      ["uint256[]", "uint256[]", "string"],
      [issuingTokenAmounts, issuingTokenAmounts, customizationDID]
    )
  );

  let signature = await signSafeTransaction(
    issuingToken.address,
    0,
    data,
    0,
    0,
    0,
    0,
    issuingToken.address, // we use the issuing token for gas
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    issuer,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    "split",
    AbiCoder.encodeParameters(
      ["uint256[]", "uint256[]", "string"],
      [issuingTokenAmounts, issuingTokenAmounts, customizationDID]
    ),
    signature,
    { from: relayer }
  );
};

exports.payMerchant = async function (
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  gasToken,
  relayer,
  customerAddress,
  merchantSafe,
  spendAmount,
  usdRate
) {
  if (usdRate == null) {
    usdRate = 100000000; // 1 DAI = 1 USD
  }
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    "payMerchant",
    AbiCoder.encodeParameters(["address"], [merchantSafe])
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

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    "payMerchant",
    AbiCoder.encodeParameters(["address"], [merchantSafe]),
    signature,
    { from: relayer }
  );
};

exports.advanceBlock = async function (web3) {
  //passes local ganache web3
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_mine",
        id: new Date().getTime(),
      },
      (err) => {
        if (err) {
          return reject(err);
        }
        const newBlockHash = web3.eth.getBlock("latest").hash;

        return resolve(newBlockHash);
      }
    );
  });
};

exports.registerRewardee = async function (
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  gasToken,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  rewardProgramID
) {
  if (usdRate == null) {
    usdRate = 100000000; // 1 DAI = 1 USD
  }
  const actionName = "registerRewardee";
  const actionData = AbiCoder.encodeParameters(["address"], [rewardProgramID]);
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData
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
    prepaidCardOwner,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.transferRewardSafe = async function (
  rewardManager,
  rewardSafe,
  oldOwner,
  newOwner,
  gasToken,
  gasRecipient,
  rewardProgramID
) {
  const data = AbiCoder.encodeFunctionCall(
    {
      name: "swapOwner",
      type: "function",
      inputs: [
        {
          type: "address",
          name: "prevOwner", //the contract that made the safe
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
    [rewardManager.address, oldOwner, newOwner]
  );
  let previousOwnerSignature = await signSafeTransaction(
    rewardSafe.address,
    0,
    data,
    0,
    0,
    0,
    0,
    gasToken.address,
    rewardSafe.address,
    await rewardSafe.nonce(),
    oldOwner,
    rewardSafe
  );
  return await rewardManager.transferRewardSafe(
    rewardSafe.address,
    rewardProgramID,
    gasToken.address,
    gasRecipient,
    previousOwnerSignature,
    data
  );
};

exports.registerRewardProgram = async function (
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  gasToken,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  admin,
  rewardProgramID
) {
  if (usdRate == null) {
    usdRate = 100000000; // 1 DAI = 1 USD
  }
  const actionName = "registerRewardProgram";
  const actionData = AbiCoder.encodeParameters(
    ["address", "address"],
    [admin, rewardProgramID]
  );
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData
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
    prepaidCardOwner,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.lockRewardProgram = async function (
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  gasToken,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  rewardProgramID
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }

  const actionName = "lockRewardProgram";
  const actionData = AbiCoder.encodeParameters(["address"], [rewardProgramID]);
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData
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
    prepaidCardOwner,
    prepaidCard
  );
  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.addRewardRule = async function (
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  gasToken,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  rewardProgramID,
  ruleDID,
  tallyRuleDID,
  benefitDID
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }

  const actionName = "addRewardRule";
  const actionData = AbiCoder.encodeParameters(
    ["address", "string", "string", "string"],
    [rewardProgramID, ruleDID, tallyRuleDID, benefitDID]
  );
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData
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
    prepaidCardOwner,
    prepaidCard
  );
  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.removeRewardRule = async function (
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  gasToken,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  rewardProgramID,
  ruleDID
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }

  const actionName = "removeRewardRule";
  const actionData = AbiCoder.encodeParameters(
    ["address", "string"],
    [rewardProgramID, ruleDID]
  );
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData
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
    prepaidCardOwner,
    prepaidCard
  );
  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.updateRewardProgramAdmin = async function (
  prepaidCardManager,
  prepaidCard,
  issuingToken,
  gasToken,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  rewardProgramID,
  newAdmin
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }
  const actionName = "updateRewardProgramAdmin";
  const actionData = AbiCoder.encodeParameters(
    ["address", "address"],
    [rewardProgramID, newAdmin]
  );
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData
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
    prepaidCardOwner,
    prepaidCard
  );
  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

// function to airdrops gas tokens to safe so it can pay the relayer
// - cardstack ("we") do these airdrops, the funds are recouped from fee charged
const DEFAULT_AIRDROP_AMOUNT_IN_WEI = toTokenUnit(1);
const airdropGas = async function (
  token,
  to,
  amountInWei = DEFAULT_AIRDROP_AMOUNT_IN_WEI
) {
  // the default gas token is cardcpxd
  return token.mint(to, amountInWei);
};

// function to create prepaid cards
// - abstracts away issuer prepaid card creation and transfer
// - creates 1 prepaid card
exports.createPrepaidCardAndTransfer = async function (
  //general
  prepaidCardManager,
  relayer,
  //create prepaid card
  depot,
  issuer,
  issuingToken,
  issuingTokenAmount,
  gasToken,
  //transfer
  newOwner,
  transferGasToken
) {
  let prepaidCard;
  ({
    prepaidCards: [prepaidCard],
  } = await createPrepaidCards(
    depot,
    prepaidCardManager,
    issuingToken,
    gasToken,
    issuer,
    relayer,
    [issuingTokenAmount]
  ));
  await airdropGas(transferGasToken, prepaidCard.address);
  await transferOwner(
    prepaidCardManager,
    prepaidCard,
    issuer,
    newOwner,
    transferGasToken,
    relayer,
    issuingToken
  );
  return prepaidCard;
};

exports.toTokenUnit = toTokenUnit;
exports.encodeCreateCardsData = encodeCreateCardsData;
exports.packExecutionData = packExecutionData;
exports.signAndSendSafeTransaction = signAndSendSafeTransaction;
exports.airdropGas = airdropGas;
exports.transferOwner = transferOwner;
exports.createPrepaidCards = createPrepaidCards;
