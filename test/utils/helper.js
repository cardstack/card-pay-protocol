const GnosisSafe = artifacts.require("GnosisSafe");
const RewardSafeDelegateImplementation = artifacts.require(
  "RewardSafeDelegateImplementation"
);
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
const SetPrepaidCardInventoryHandler = artifacts.require(
  "SetPrepaidCardInventoryHandler"
);
const RemovePrepaidCardInventoryHandler = artifacts.require(
  "RemovePrepaidCardInventoryHandler"
);
const SetPrepaidCardAskHandler = artifacts.require("SetPrepaidCardAskHandler");
const TransferPrepaidCardHandler = artifacts.require(
  "TransferPrepaidCardHandler"
);
const RegisterRewardeeHandler = artifacts.require("RegisterRewardeeHandler");
const RegisterRewardProgramHandler = artifacts.require(
  "RegisterRewardProgramHandler"
);
const LockRewardProgramHandler = artifacts.require("LockRewardProgramHandler");
const AddRewardRuleHandler = artifacts.require("AddRewardRuleHandler");
const UpdateRewardProgramAdminHandler = artifacts.require(
  "UpdateRewardProgramAdminHandler"
);
const PayRewardTokensHandler = artifacts.require("PayRewardTokensHandler");
const VersionManager = artifacts.require("VersionManager");
const PrepaidCardMarket = artifacts.require("PrepaidCardMarket");

const { toBN, toChecksumAddress, randomHex } = require("web3-utils");
const eventABIs = require("./constant/eventABIs");
const {
  getParamsFromEvent,
  getParamFromTxEvent,
  signSafeTransaction,
  ZERO_ADDRESS,
  getGnosisSafeFromEventLog,
  rewardEIP1271Signature,
  checkGnosisExecution,
} = require("./general");

// we'll just use the block gas limit as a safe tx gas estimate because its
// easy and the relay server is really responsible for this (and not part of
// these tests)
const BLOCK_GAS_LIMIT = 6000000;
const DEFAULT_GAS_PRICE = 1000000000;
const SENTINEL_OWNER = "0x0000000000000000000000000000000000000001";
const CALL = 0;
const DELEGATE_CALL = 1;

function toTokenUnit(_numberToken, _decimals = 18) {
  let dec = toBN("10").pow(toBN(_decimals));
  let number = toBN(_numberToken);
  return number.mul(dec);
}

function encodeCreateCardsData(
  account,
  issuingTokenAmounts = [],
  spendAmounts = [],
  customizationDID = "",
  marketAddress = ZERO_ADDRESS,
  issuer = ZERO_ADDRESS,
  issuerSafe = ZERO_ADDRESS
) {
  return AbiCoder.encodeParameters(
    [
      "address",
      "uint256[]",
      "uint256[]",
      "string",
      "address",
      "address",
      "address",
    ],
    [
      account,
      issuingTokenAmounts,
      spendAmounts,
      customizationDID,
      marketAddress,
      issuer,
      issuerSafe,
    ]
  );
}

function packExecutionData({
  to,
  value = 0,
  data,
  operation = CALL,
  txGasEstimate = 0,
  baseGasEstimate = 0,
  gasPrice = 0,
  txGasToken = ZERO_ADDRESS,
  refundReceiver = ZERO_ADDRESS,
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
    refundReceiver,
  };
}

async function getTransferPrepaidCardOwnerSignature(
  prepaidCardManager,
  prepaidCard,
  oldOwner,
  newOwner,
  gasToken,
  advanceNonce = true
) {
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
  return await signSafeTransaction(
    ...safeTxArr,
    // the quirk here is that we are signing this txn in advance so we need to
    // optimistically advance the nonce by 1 to account for the fact that we are
    // executing the "send" action before this one.
    advanceNonce ? nonce.add(toBN("1")) : nonce,
    oldOwner,
    prepaidCard
  );
}

async function getIssuingToken(prepaidCardManager, prepaidCard) {
  let details = await prepaidCardManager.cardDetails(prepaidCard.address);
  return await ERC677Token.at(details.issueToken);
}

async function sendSafeTransaction(
  safeTxData,
  gnosisSafe,
  relayer,
  signature,
  options = null
) {
  let packData = packExecutionData(safeTxData);
  let safeTxArr = Object.keys(packData).map((key) => packData[key]);
  let nonce = await gnosisSafe.nonce();
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
    executionResult: checkGnosisExecution(safeTx, gnosisSafe.address),
  };
}

async function signAndSendSafeTransaction(
  safeTxData,
  owner,
  gnosisSafe,
  relayer,
  options = null
) {
  let nonce = await gnosisSafe.nonce();
  let packData = packExecutionData(safeTxData);
  let safeTxArr = Object.keys(packData).map((key) => packData[key]);
  let signature = await signSafeTransaction(
    ...safeTxArr,
    nonce,
    owner,
    gnosisSafe
  );
  return await sendSafeTransaction(
    safeTxData,
    gnosisSafe,
    relayer,
    signature,
    options
  );
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
    `Could not find an account address that is lexigraphically before the address ${address} from ${accounts.length} possibilities. Please adjust the mnemonic in hardhat.config.ts to get a new random set of accounts that hopefully is better ordered.`
  );
};

exports.findAccountAfterAddress = (accounts, address) => {
  for (let account of accounts) {
    if (account.toLowerCase() > address.toLowerCase()) {
      return account;
    }
  }
  throw new Error(
    `Could not find an account address that is lexigraphically after the address ${address} from ${accounts.length} possibilities. Please adjust the mnemonic in hardhat.config.ts to get a new random set of accounts that hopefully is better ordered.`
  );
};

exports.setupVersionManager = async function (owner, version = "1.0.0") {
  let versionManager = await VersionManager.new();
  await versionManager.initialize(owner);
  await versionManager.setVersion(version);
  return versionManager;
};

exports.setupExchanges = async function (
  owner,
  versionManager,
  canSnapToUSD = false
) {
  let daicpxdToken = await ERC677Token.new();
  let versionManagerAddress = versionManager
    ? versionManager.address
    : (await exports.setupVersionManager(owner)).address;
  await daicpxdToken.initialize("DAI (CPXD)", "DAI.CPXD", 18, owner);

  let cardcpxdToken = await ERC677Token.new();
  await cardcpxdToken.initialize("CARD (CPXD)", "CARD.CPXD", 18, owner);

  let daiFeed = await Feed.new();
  await daiFeed.initialize(owner);
  await daiFeed.setup("DAI.CPXD", 8, versionManagerAddress);
  await daiFeed.addRound(100000000, 1618433281, 1618433281);
  let ethFeed = await Feed.new();
  await ethFeed.initialize(owner);
  await ethFeed.setup("ETH", 8, versionManagerAddress);
  await ethFeed.addRound(300000000000, 1618433281, 1618433281);
  let chainlinkOracle = await ChainlinkOracle.new();
  chainlinkOracle.initialize(owner);
  await chainlinkOracle.setup(
    daiFeed.address,
    ethFeed.address,
    daiFeed.address,
    canSnapToUSD,
    0,
    versionManagerAddress
  );
  let mockDiaOracle = await MockDIAOracle.new();
  await mockDiaOracle.initialize(owner);
  await mockDiaOracle.setValue("CARD/USD", 1000000, 1618433281);
  let diaPriceOracle = await DIAPriceOracle.new();
  await diaPriceOracle.initialize(owner);
  await diaPriceOracle.setup(
    mockDiaOracle.address,
    "CARD",
    daiFeed.address,
    versionManagerAddress
  );

  let exchange = await Exchange.new();
  await exchange.initialize(owner);
  await exchange.setup(1000000, versionManagerAddress, "CARD.CPXD"); // this is a 1% rate margin drift
  await exchange.createExchange("DAI.CPXD", chainlinkOracle.address);
  await exchange.createExchange("CARD.CPXD", diaPriceOracle.address);

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

exports.addActionHandlers = async function ({
  prepaidCardManager,
  revenuePool,
  actionDispatcher,
  merchantManager,
  tokenManager,
  rewardManager,
  owner,
  exchangeAddress,
  spendAddress,
  rewardPool,
  prepaidCardMarket,
  versionManager,
}) {
  let payMerchantHandler,
    registerMerchantHandler,
    splitPrepaidCardHandler,
    setPrepaidCardInventoryHandler,
    removePrepaidCardInventoryHandler,
    setPrepaidCardAskHandler,
    transferPrepaidCardHandler,
    registerRewardeeHandler,
    registerRewardProgramHandler,
    lockRewardProgramHandler,
    addRewardRuleHandler,
    updateRewardProgramAdminHandler,
    payRewardTokensHandler;

  let versionManagerAddress = versionManager
    ? versionManager.address
    : (await exports.setupVersionManager(owner)).address;

  if (
    owner &&
    actionDispatcher &&
    merchantManager &&
    prepaidCardManager &&
    revenuePool &&
    spendAddress &&
    tokenManager
  ) {
    payMerchantHandler = await PayMerchantHandler.new();
    await payMerchantHandler.initialize(owner);
    await payMerchantHandler.setup(
      actionDispatcher.address,
      merchantManager.address,
      prepaidCardManager.address,
      revenuePool.address,
      spendAddress,
      tokenManager.address,
      versionManagerAddress
    );
  }

  if (
    owner &&
    actionDispatcher &&
    merchantManager &&
    prepaidCardManager &&
    revenuePool &&
    exchangeAddress &&
    tokenManager
  ) {
    registerMerchantHandler = await RegisterMerchantHandler.new();
    await registerMerchantHandler.initialize(owner);
    await registerMerchantHandler.setup(
      actionDispatcher.address,
      merchantManager.address,
      prepaidCardManager.address,
      revenuePool.address,
      exchangeAddress,
      tokenManager.address,
      versionManagerAddress
    );
  }

  if (owner && actionDispatcher && prepaidCardManager && tokenManager) {
    splitPrepaidCardHandler = await SplitPrepaidCardHandler.new();
    await splitPrepaidCardHandler.initialize(owner);
    if (!prepaidCardMarket) {
      prepaidCardMarket = await PrepaidCardMarket.new();
      await prepaidCardMarket.initialize(owner);
      await prepaidCardMarket.setup(
        prepaidCardManager.address,
        actionDispatcher.address,
        owner,
        versionManager.address
      );
    }

    await splitPrepaidCardHandler.setup(
      actionDispatcher.address,
      prepaidCardManager.address,
      tokenManager.address,
      prepaidCardMarket.address,
      versionManagerAddress
    );
  }

  if (owner && actionDispatcher && prepaidCardManager && tokenManager) {
    setPrepaidCardInventoryHandler = await SetPrepaidCardInventoryHandler.new();
    await setPrepaidCardInventoryHandler.initialize(owner);
    await setPrepaidCardInventoryHandler.setup(
      actionDispatcher.address,
      prepaidCardManager.address,
      tokenManager.address,
      versionManagerAddress
    );
    removePrepaidCardInventoryHandler =
      await RemovePrepaidCardInventoryHandler.new();
    await removePrepaidCardInventoryHandler.initialize(owner);
    await removePrepaidCardInventoryHandler.setup(
      actionDispatcher.address,
      prepaidCardManager.address,
      tokenManager.address,
      versionManagerAddress
    );
    setPrepaidCardAskHandler = await SetPrepaidCardAskHandler.new();
    await setPrepaidCardAskHandler.initialize(owner);
    await setPrepaidCardAskHandler.setup(
      actionDispatcher.address,
      prepaidCardManager.address,
      tokenManager.address,
      versionManagerAddress
    );
  }

  if (owner && actionDispatcher && prepaidCardManager && tokenManager) {
    transferPrepaidCardHandler = await TransferPrepaidCardHandler.new();
    await transferPrepaidCardHandler.initialize(owner);
    await transferPrepaidCardHandler.setup(
      actionDispatcher.address,
      prepaidCardManager.address,
      tokenManager.address,
      versionManagerAddress
    );
  }

  if (
    owner &&
    actionDispatcher &&
    prepaidCardManager &&
    exchangeAddress &&
    tokenManager &&
    rewardManager
  ) {
    registerRewardeeHandler = await RegisterRewardeeHandler.new();
    await registerRewardeeHandler.initialize(owner);
    await registerRewardeeHandler.setup(
      actionDispatcher.address,
      prepaidCardManager.address,
      exchangeAddress,
      tokenManager.address,
      rewardManager.address,
      versionManagerAddress
    );
  }

  if (
    owner &&
    actionDispatcher &&
    exchangeAddress &&
    tokenManager &&
    rewardManager &&
    prepaidCardManager
  ) {
    registerRewardProgramHandler = await RegisterRewardProgramHandler.new();
    await registerRewardProgramHandler.initialize(owner);
    await registerRewardProgramHandler.setup(
      actionDispatcher.address,
      exchangeAddress,
      tokenManager.address,
      rewardManager.address,
      prepaidCardManager.address,
      versionManagerAddress
    );
  }

  if (
    owner &&
    actionDispatcher &&
    prepaidCardManager &&
    exchangeAddress &&
    tokenManager &&
    rewardManager
  ) {
    lockRewardProgramHandler = await LockRewardProgramHandler.new();
    await lockRewardProgramHandler.initialize(owner);
    await lockRewardProgramHandler.setup(
      actionDispatcher.address,
      prepaidCardManager.address,
      exchangeAddress,
      tokenManager.address,
      rewardManager.address,
      versionManagerAddress
    );
  }

  if (
    owner &&
    actionDispatcher &&
    prepaidCardManager &&
    exchangeAddress &&
    tokenManager &&
    rewardManager
  ) {
    addRewardRuleHandler = await AddRewardRuleHandler.new();
    await addRewardRuleHandler.initialize(owner);
    await addRewardRuleHandler.setup(
      actionDispatcher.address,
      prepaidCardManager.address,
      exchangeAddress,
      tokenManager.address,
      rewardManager.address,
      versionManagerAddress
    );
  }

  if (
    owner &&
    actionDispatcher &&
    prepaidCardManager &&
    exchangeAddress &&
    tokenManager &&
    rewardManager
  ) {
    updateRewardProgramAdminHandler =
      await UpdateRewardProgramAdminHandler.new();
    await updateRewardProgramAdminHandler.initialize(owner);
    await updateRewardProgramAdminHandler.setup(
      actionDispatcher.address,
      prepaidCardManager.address,
      exchangeAddress,
      tokenManager.address,
      rewardManager.address,
      versionManagerAddress
    );
  }

  if (
    owner &&
    actionDispatcher &&
    tokenManager &&
    rewardPool &&
    prepaidCardManager
  ) {
    payRewardTokensHandler = await PayRewardTokensHandler.new();
    await payRewardTokensHandler.initialize(owner);
    await payRewardTokensHandler.setup(
      actionDispatcher.address,
      tokenManager.address,
      rewardPool.address,
      prepaidCardManager.address,
      versionManagerAddress
    );
  }

  if (payMerchantHandler) {
    await actionDispatcher.addHandler(
      payMerchantHandler.address,
      "payMerchant"
    );
  }

  if (splitPrepaidCardHandler) {
    await actionDispatcher.addHandler(splitPrepaidCardHandler.address, "split");
  }

  if (setPrepaidCardInventoryHandler) {
    await actionDispatcher.addHandler(
      setPrepaidCardInventoryHandler.address,
      "setPrepaidCardInventory"
    );
  }

  if (removePrepaidCardInventoryHandler) {
    await actionDispatcher.addHandler(
      removePrepaidCardInventoryHandler.address,
      "removePrepaidCardInventory"
    );
  }

  if (setPrepaidCardAskHandler) {
    await actionDispatcher.addHandler(
      setPrepaidCardAskHandler.address,
      "setPrepaidCardAsk"
    );
  }

  if (transferPrepaidCardHandler) {
    await actionDispatcher.addHandler(
      transferPrepaidCardHandler.address,
      "transfer"
    );
  }

  if (registerMerchantHandler) {
    await actionDispatcher.addHandler(
      registerMerchantHandler.address,
      "registerMerchant"
    );
  }

  if (registerRewardeeHandler) {
    await actionDispatcher.addHandler(
      registerRewardeeHandler.address,
      "registerRewardee"
    );
  }

  if (registerRewardProgramHandler) {
    await actionDispatcher.addHandler(
      registerRewardProgramHandler.address,
      "registerRewardProgram"
    );
  }

  if (lockRewardProgramHandler) {
    await actionDispatcher.addHandler(
      lockRewardProgramHandler.address,
      "lockRewardProgram"
    );
  }

  if (addRewardRuleHandler) {
    await actionDispatcher.addHandler(
      addRewardRuleHandler.address,
      "addRewardRule"
    );
  }

  if (updateRewardProgramAdminHandler) {
    await actionDispatcher.addHandler(
      updateRewardProgramAdminHandler.address,
      "updateRewardProgramAdmin"
    );
  }

  if (payRewardTokensHandler) {
    await actionDispatcher.addHandler(
      payRewardTokensHandler.address,
      "payRewardTokens"
    );
  }
  return {
    payMerchantHandler,
    registerMerchantHandler,
    splitPrepaidCardHandler,
    setPrepaidCardInventoryHandler,
    removePrepaidCardInventoryHandler,
    setPrepaidCardAskHandler,
    transferPrepaidCardHandler,
    registerRewardeeHandler,
    registerRewardProgramHandler,
    lockRewardProgramHandler,
    addRewardRuleHandler,
    updateRewardProgramAdminHandler,
    payRewardTokensHandler,
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
  issuer,
  relayer,
  issuingTokenAmounts,
  amountToSend,
  customizationDID,
  marketAddress,
  issuerSafe
) {
  let createCardData = encodeCreateCardsData(
    issuer,
    issuingTokenAmounts.map((amount) =>
      typeof amount === "string" ? amount : amount.toString()
    ),
    issuingTokenAmounts.map((amount) =>
      typeof amount === "string" ? amount : amount.toString()
    ),
    customizationDID,
    marketAddress,
    issuer,
    issuerSafe || ZERO_ADDRESS
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
    .estimateGas({ from: depot.address });

  let safeTxData = {
    to: issuingToken.address,
    data: payloads,
    txGasEstimate: gasEstimate,
    gasPrice: DEFAULT_GAS_PRICE,
    txGasToken: issuingToken.address,
    refundReceiver: relayer,
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
  relayer,
  eip1271Signature
) {
  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
  let usdRate = 100000000; // 1 DAI = 1 USD
  let previousOwnerSignature =
    eip1271Signature ??
    (await getTransferPrepaidCardOwnerSignature(
      prepaidCardManager,
      prepaidCard,
      oldOwner,
      newOwner,
      issuingToken
    ));
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

  let signature =
    eip1271Signature ??
    (await signSafeTransaction(
      issuingToken.address,
      0,
      data,
      CALL,
      0,
      0,
      0,
      issuingToken.address,
      ZERO_ADDRESS,
      await prepaidCard.nonce(),
      oldOwner,
      prepaidCard
    ));

  return await prepaidCardManager.send(
    prepaidCard.address,
    0,
    usdRate,
    0,
    0,
    0,
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
  relayer,
  merchant,
  spendAmount,
  usdRate,
  infoDID = ""
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }
  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
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
    CALL,
    0,
    0,
    0,
    issuingToken.address,
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    merchant,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    0,
    0,
    0,
    "registerMerchant",
    AbiCoder.encodeParameters(["string"], [infoDID]),
    signature,
    { from: relayer }
  );
};

exports.setPrepaidCardInventory = async function (
  prepaidCardManager,
  fundingPrepaidCard,
  prepaidCardForInventory,
  prepaidCardMarket,
  issuer,
  relayer,
  gasPrice,
  usdRate
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }
  if (gasPrice == null) {
    gasPrice = DEFAULT_GAS_PRICE;
  }
  let issuingToken = await getIssuingToken(
    prepaidCardManager,
    fundingPrepaidCard
  );
  let marketAddress =
    typeof prepaidCardMarket === "string"
      ? prepaidCardMarket
      : prepaidCardMarket.address;
  let previousOwnerSignature = await getTransferPrepaidCardOwnerSignature(
    prepaidCardManager,
    prepaidCardForInventory,
    issuer,
    marketAddress,
    issuingToken,
    false
  );
  let payload = AbiCoder.encodeParameters(
    ["address", "address", "bytes"],
    [prepaidCardForInventory.address, marketAddress, previousOwnerSignature]
  );
  let data = await prepaidCardManager.getSendData(
    fundingPrepaidCard.address,
    0,
    usdRate,
    "setPrepaidCardInventory",
    payload
  );
  let signature = await signSafeTransaction(
    issuingToken.address,
    0,
    data,
    CALL,
    BLOCK_GAS_LIMIT,
    0,
    gasPrice,
    issuingToken.address,
    ZERO_ADDRESS,
    await fundingPrepaidCard.nonce(),
    issuer,
    fundingPrepaidCard
  );

  return await prepaidCardManager.send(
    fundingPrepaidCard.address,
    0,
    usdRate,
    gasPrice,
    BLOCK_GAS_LIMIT,
    0,
    "setPrepaidCardInventory",
    payload,
    signature,
    { from: relayer }
  );
};

exports.removePrepaidCardInventory = async function (
  prepaidCardManager,
  fundingPrepaidCard,
  prepaidCardsToRemove,
  prepaidCardMarket,
  issuer,
  relayer,
  gasPrice,
  usdRate
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }
  if (gasPrice == null) {
    gasPrice = DEFAULT_GAS_PRICE;
  }
  let issuingToken = await getIssuingToken(
    prepaidCardManager,
    fundingPrepaidCard
  );
  let marketAddress =
    typeof prepaidCardMarket === "string"
      ? prepaidCardMarket
      : prepaidCardMarket.address;
  let payload = AbiCoder.encodeParameters(
    ["address[]", "address"],
    [prepaidCardsToRemove.map((p) => p.address), marketAddress]
  );
  let data = await prepaidCardManager.getSendData(
    fundingPrepaidCard.address,
    0,
    usdRate,
    "removePrepaidCardInventory",
    payload
  );
  let signature = await signSafeTransaction(
    issuingToken.address,
    0,
    data,
    CALL,
    BLOCK_GAS_LIMIT,
    0,
    gasPrice,
    issuingToken.address,
    ZERO_ADDRESS,
    await fundingPrepaidCard.nonce(),
    issuer,
    fundingPrepaidCard
  );

  return await prepaidCardManager.send(
    fundingPrepaidCard.address,
    0,
    usdRate,
    gasPrice,
    BLOCK_GAS_LIMIT,
    0,
    "removePrepaidCardInventory",
    payload,
    signature,
    { from: relayer }
  );
};
exports.setPrepaidCardAsk = async function (
  prepaidCardManager,
  fundingPrepaidCard,
  askPrice,
  sku,
  prepaidCardMarket,
  issuer,
  relayer,
  gasPrice,
  usdRate
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }
  if (gasPrice == null) {
    gasPrice = DEFAULT_GAS_PRICE;
  }
  let issuingToken = await getIssuingToken(
    prepaidCardManager,
    fundingPrepaidCard
  );
  let marketAddress =
    typeof prepaidCardMarket === "string"
      ? prepaidCardMarket
      : prepaidCardMarket.address;
  let payload = AbiCoder.encodeParameters(
    ["bytes32", "uint256", "address"],
    [sku, askPrice, marketAddress]
  );
  let data = await prepaidCardManager.getSendData(
    fundingPrepaidCard.address,
    0,
    usdRate,
    "setPrepaidCardAsk",
    payload
  );
  let signature = await signSafeTransaction(
    issuingToken.address,
    0,
    data,
    CALL,
    BLOCK_GAS_LIMIT,
    0,
    gasPrice,
    issuingToken.address,
    ZERO_ADDRESS,
    await fundingPrepaidCard.nonce(),
    issuer,
    fundingPrepaidCard
  );

  return await prepaidCardManager.send(
    fundingPrepaidCard.address,
    0,
    usdRate,
    gasPrice,
    BLOCK_GAS_LIMIT,
    0,
    "setPrepaidCardAsk",
    payload,
    signature,
    { from: relayer }
  );
};

exports.splitPrepaidCard = async function (
  prepaidCardManager,
  prepaidCard,
  relayer,
  issuer,
  spendAmount,
  issuingTokenAmounts,
  customizationDID,
  marketAddress,
  gasPrice,
  usdRate
) {
  if (marketAddress == null) {
    marketAddress = ZERO_ADDRESS;
  }
  if (usdRate == null) {
    usdRate = 100000000;
  }
  if (gasPrice == null) {
    gasPrice = DEFAULT_GAS_PRICE;
  }
  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
  let payload = AbiCoder.encodeParameters(
    ["uint256[]", "uint256[]", "string", "address"],
    [issuingTokenAmounts, issuingTokenAmounts, customizationDID, marketAddress]
  );
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    spendAmount,
    usdRate,
    "split",
    payload
  );

  let signature = await signSafeTransaction(
    issuingToken.address,
    0,
    data,
    CALL,
    BLOCK_GAS_LIMIT,
    0,
    gasPrice,
    issuingToken.address,
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    issuer,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    gasPrice,
    BLOCK_GAS_LIMIT,
    0,
    "split",
    payload,
    signature,
    { from: relayer }
  );
};

exports.payMerchant = async function (
  prepaidCardManager,
  prepaidCard,
  relayer,
  customerAddress,
  merchantSafe,
  spendAmount,
  usdRate
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }
  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
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
    CALL,
    0,
    0,
    0,
    issuingToken.address,
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    customerAddress,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    0,
    0,
    0,
    "payMerchant",
    AbiCoder.encodeParameters(["address"], [merchantSafe]),
    signature,
    { from: relayer }
  );
};

exports.advanceBlock = async function (web3) {
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
  relayer,
  prepaidCardOwner,
  usdRate,
  rewardProgramID
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }
  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
  const actionName = "registerRewardee";
  const actionData = AbiCoder.encodeParameters(["address"], [rewardProgramID]);
  let data = await prepaidCardManager.getSendData(
    prepaidCard.address,
    0, //do not need to send spend amount
    usdRate,
    actionName,
    actionData
  );

  let signature = await signSafeTransaction(
    issuingToken.address,
    0,
    data,
    CALL,
    BLOCK_GAS_LIMIT,
    0,
    DEFAULT_GAS_PRICE,
    issuingToken.address,
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    prepaidCardOwner,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    0, // do not need to send spend amount
    usdRate,
    DEFAULT_GAS_PRICE,
    BLOCK_GAS_LIMIT,
    0,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

const transferRewardSafe = async function ({
  rewardManager,
  rewardSafe,
  oldOwner,
  newOwner,
  relayer,
  gasToken,
}) {
  let delegateImplementation = await RewardSafeDelegateImplementation.at(
    await rewardManager.safeDelegateImplementation()
  );

  let payload = delegateImplementation.contract.methods.swapOwner(
    rewardManager.address,
    rewardManager.address,
    oldOwner,
    newOwner
  );
  let data = payload.encodeABI();

  const fullSignature = await rewardEIP1271Signature({
    // When using DELEGATE_CALL, the "to" argument is misleading.
    // The transaction is actually sent to the safe address, but using the contract
    // implementation at the adderess passed in the "to" field
    to: delegateImplementation.address,
    value: 0,
    data,
    operation: DELEGATE_CALL,
    txGasEstimate: 0,
    baseGasEstimate: 0,
    gasPrice: 0,
    txGasToken: gasToken.address,
    refundReceiver: rewardSafe.address,
    nonce: await rewardSafe.nonce(),
    owner: oldOwner,
    gnosisSafe: rewardSafe,
    verifyingContract: rewardManager,
  });

  let safeTxData = {
    to: delegateImplementation.address,
    data,
    operation: DELEGATE_CALL,
    txGasEstimate: 0,
    gasPrice: 0,
    txGasToken: gasToken.address,
    refundReceiver: rewardSafe.address,
  };

  return await sendSafeTransaction(
    safeTxData,
    rewardSafe,
    relayer,
    fullSignature
  );
};
async function withdrawFromRewardSafe({
  rewardManager,
  rewardSafe,
  tokenAddress,
  to,
  value,
  relayer,
  gasToken,
}) {
  const rewardSafeEOA = (await rewardSafe.getOwners())[1];
  let token = await ERC677Token.at(tokenAddress);

  let delegateImplementation = await RewardSafeDelegateImplementation.at(
    await rewardManager.safeDelegateImplementation()
  );

  let payload = delegateImplementation.contract.methods.withdraw(
    rewardManager.address,
    token.address,
    to,
    value
  );
  let data = payload.encodeABI();

  const fullSignature = await rewardEIP1271Signature({
    // When using DELEGATE_CALL, the "to" argument is misleading.
    // The transaction is actually sent to the safe address, but using the contract
    // implementation at the adderess passed in the "to" field
    to: delegateImplementation.address,
    value: 0,
    data,
    operation: DELEGATE_CALL,
    txGasEstimate: 0,
    baseGasEstimate: 0,
    gasPrice: 0,
    txGasToken: gasToken.address,
    refundReceiver: rewardSafe.address,
    nonce: await rewardSafe.nonce(),
    owner: rewardSafeEOA,
    gnosisSafe: rewardSafe,
    verifyingContract: rewardManager,
  });

  let safeTxData = {
    to: delegateImplementation.address,
    data,
    operation: DELEGATE_CALL,
    txGasEstimate: 0,
    gasPrice: 0,
    txGasToken: gasToken.address,
    refundReceiver: rewardSafe.address,
  };

  return await sendSafeTransaction(
    safeTxData,
    rewardSafe,
    relayer,
    fullSignature
  );
}

exports.swapOwner = async function (
  rewardManager,
  rewardSafe,
  oldOwner,
  newOwner,
  relayer,
  gasToken
) {
  const swapData = AbiCoder.encodeFunctionCall(
    {
      name: "swapOwner",
      type: "function",
      inputs: [
        {
          type: "address",
          name: "prevOwner",
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
    [SENTINEL_OWNER, oldOwner, newOwner]
  );

  let safeTxData = {
    to: rewardSafe.address,
    data: swapData,
    operation: 0,
    txGasEstimate: 0,
    gasPrice: 0,
    txGasToken: gasToken.address,
    refundReceiver: rewardSafe.address,
  };

  let { safeTxHash, safeTx } = await signAndSendSafeTransaction(
    safeTxData,
    oldOwner,
    rewardSafe,
    relayer
  );

  return {
    safeTx,
    safeTxHash,
    executionResult: checkGnosisExecution(safeTx, rewardSafe.address),
  };
};

exports.swapOwnerWithFullSignature = async function (
  rewardManager,
  rewardSafe,
  oldOwner,
  newOwner,
  relayer,
  gasToken
) {
  const swapData = AbiCoder.encodeFunctionCall(
    {
      name: "swapOwner",
      type: "function",
      inputs: [
        {
          type: "address",
          name: "prevOwner",
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

  let safeTxData = {
    to: rewardSafe.address,
    data: swapData,
    operation: 0,
    txGasEstimate: 0,
    gasPrice: 0,
    txGasToken: gasToken.address,
    refundReceiver: rewardSafe.address,
  };
  let nonce = await rewardSafe.nonce();

  let packData = packExecutionData(safeTxData);
  let signature = await rewardEIP1271Signature({
    ...packData,
    nonce,
    owner: oldOwner,
    gnosisSafe: rewardSafe,
    verifyingContract: rewardManager,
  });
  return await sendSafeTransaction(safeTxData, rewardSafe, relayer, signature);
};

exports.registerRewardProgram = async function (
  prepaidCardManager,
  prepaidCard,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  admin,
  rewardProgramID
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }
  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
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
    CALL,
    0,
    0,
    0,
    issuingToken.address,
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    prepaidCardOwner,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    0,
    0,
    0,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.lockRewardProgram = async function (
  prepaidCardManager,
  prepaidCard,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  rewardProgramID
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }

  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
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
    CALL,
    BLOCK_GAS_LIMIT,
    0,
    DEFAULT_GAS_PRICE,
    issuingToken.address,
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    prepaidCardOwner,
    prepaidCard
  );
  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    DEFAULT_GAS_PRICE,
    BLOCK_GAS_LIMIT,
    0,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.addRewardRule = async function (
  prepaidCardManager,
  prepaidCard,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  rewardProgramID,
  blob
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }

  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
  const actionName = "addRewardRule";
  const actionData = AbiCoder.encodeParameters(
    ["address", "bytes"],
    [rewardProgramID, blob]
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
    CALL,
    BLOCK_GAS_LIMIT,
    0,
    DEFAULT_GAS_PRICE,
    issuingToken.address,
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    prepaidCardOwner,
    prepaidCard
  );
  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    DEFAULT_GAS_PRICE,
    BLOCK_GAS_LIMIT,
    0,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.updateRewardProgramAdmin = async function (
  prepaidCardManager,
  prepaidCard,
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
  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
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
    CALL,
    BLOCK_GAS_LIMIT,
    0,
    DEFAULT_GAS_PRICE,
    issuingToken.address,
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    prepaidCardOwner,
    prepaidCard
  );
  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    DEFAULT_GAS_PRICE,
    BLOCK_GAS_LIMIT,
    0,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.createPrepaidCardAndTransfer = async function (
  prepaidCardManager,
  relayer,
  depot,
  issuer,
  issuingToken,
  issuingTokenAmount,
  newOwner
) {
  let prepaidCard;
  ({
    prepaidCards: [prepaidCard],
  } = await createPrepaidCards(
    depot,
    prepaidCardManager,
    issuingToken,
    issuer,
    relayer,
    [issuingTokenAmount]
  ));
  await transferOwner(
    prepaidCardManager,
    prepaidCard,
    issuer,
    newOwner,
    relayer
  );
  return prepaidCard;
};

exports.claimReward = async function (
  rewardManager,
  rewardPool,
  relayer,
  rewardSafe,
  rewardSafeOwner,
  token,
  leaf,
  proof,
  partial = false
) {
  let claimReward = rewardPool.contract.methods.claim(leaf, proof, partial);
  let payload = claimReward.encodeABI();
  let gasEstimate = await claimReward.estimateGas({ from: rewardSafe.address });

  let safeTxData = {
    to: rewardPool.address,
    data: payload,
    txGasEstimate: gasEstimate,
    gasPrice: DEFAULT_GAS_PRICE,
    txGasToken: token.address,
    refundReceiver: relayer,
  };

  const nonce = await rewardSafe.nonce();

  let packData = packExecutionData(safeTxData);

  let signature = await rewardEIP1271Signature({
    ...packData,
    nonce,
    owner: rewardSafeOwner,
    gnosisSafe: rewardSafe,
    verifyingContract: rewardManager,
  });

  return await sendSafeTransaction(safeTxData, rewardSafe, relayer, signature);
};

exports.recoverUnclaimedRewardTokens = async function (
  rewardManager,
  rewardPool,
  relayer,
  rewardSafe,
  rewardSafeOwner,
  rewardProgramID,
  token,
  amount
) {
  let recoverTokens = rewardPool.contract.methods.recoverTokens(
    rewardProgramID,
    token.address,
    amount
  );

  let payload = recoverTokens.encodeABI();
  let gasEstimate = await recoverTokens.estimateGas({
    from: rewardSafe.address,
  });

  let safeTxData = {
    to: rewardPool.address,
    data: payload,
    txGasEstimate: gasEstimate,
    gasPrice: DEFAULT_GAS_PRICE,
    txGasToken: token.address,
    refundReceiver: relayer,
  };

  const nonce = await rewardSafe.nonce();

  let packData = packExecutionData(safeTxData);

  let signature = await rewardEIP1271Signature({
    ...packData,
    nonce,
    owner: rewardSafeOwner,
    gnosisSafe: rewardSafe,
    verifyingContract: rewardManager,
  });

  return await sendSafeTransaction(safeTxData, rewardSafe, relayer, signature);
};

exports.mintWalletAndRefillPool = async function (
  rewardToken,
  rewardPool,
  rewardProgramAdmin,
  amount,
  rewardProgramID
) {
  await rewardToken.mint(rewardProgramAdmin, amount);
  await rewardToken.transferAndCall(
    rewardPool.address,
    amount,
    AbiCoder.encodeParameters(["address"], [rewardProgramID]),
    { from: rewardProgramAdmin }
  );
};

exports.payRewardTokens = async function (
  prepaidCardManager,
  prepaidCard,
  relayer,
  prepaidCardOwner,
  spendAmount,
  usdRate,
  rewardProgramID
) {
  if (usdRate == null) {
    usdRate = 100000000;
  }
  let issuingToken = await getIssuingToken(prepaidCardManager, prepaidCard);
  const actionName = "payRewardTokens";
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
    CALL,
    BLOCK_GAS_LIMIT,
    0,
    DEFAULT_GAS_PRICE,
    issuingToken.address,
    ZERO_ADDRESS,
    await prepaidCard.nonce(),
    prepaidCardOwner,
    prepaidCard
  );

  return await prepaidCardManager.send(
    prepaidCard.address,
    spendAmount,
    usdRate,
    DEFAULT_GAS_PRICE,
    BLOCK_GAS_LIMIT,
    0,
    actionName,
    actionData,
    signature,
    { from: relayer }
  );
};

exports.getPoolBalanceByRewardProgram = async function (
  rewardProgramID,
  rewardPool,
  token
) {
  return rewardPool.rewardBalance(rewardProgramID, token.address);
};

exports.burnDepotTokens = async function (depot, token, owner, relayer) {
  let balance = await token.balanceOf(depot.address);
  let data = token.contract.methods.burn(balance).encodeABI();

  let safeTxData = {
    to: token.address,
    data,
  };

  await signAndSendSafeTransaction(safeTxData, owner, depot, relayer);
};

exports.generateRewardProgramID = () => {
  return toChecksumAddress(randomHex(20));
};

exports.toTokenUnit = toTokenUnit;
exports.encodeCreateCardsData = encodeCreateCardsData;
exports.packExecutionData = packExecutionData;
exports.signAndSendSafeTransaction = signAndSendSafeTransaction;
exports.sendSafeTransaction = sendSafeTransaction;
exports.transferOwner = transferOwner;
exports.createPrepaidCards = createPrepaidCards;
exports.transferRewardSafe = transferRewardSafe;
exports.withdrawFromRewardSafe = withdrawFromRewardSafe;
