const { readJSONSync, existsSync } = require("node-fs-extra");
const { resolve } = require("path");
const Web3 = require("web3");
const { sendTxnWithRetry: sendTx } = require("../lib/utils");
const { fromWei } = Web3.utils;

const RevenuePool = artifacts.require("RevenuePool");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const BridgeUtils = artifacts.require("BridgeUtils");
const SPEND = artifacts.require("SPEND");
const RewardPool = artifacts.require("RewardPool");
const Exchange = artifacts.require("Exchange");
const PayMerchantHandler = artifacts.require("PayMerchantHandler");
const RegisterMerchantHandler = artifacts.require("RegisterMerchantHandler");
const SplitPrepaidCardHandler = artifacts.require("SplitPrepaidCardHandler");
const TransferPrepaidCardHandler = artifacts.require(
  "TransferPrepaidCardHandler"
);
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const MerchantManager = artifacts.require("MerchantManager");
const RewardManager = artifacts.require("RewardManager");
const RegisterRewardProgramHandler = artifacts.require(
  "RegisterRewardProgramHandler"
);
const RegisterRewardeeHandler = artifacts.require("RegisterRewardeeHandler");
const LockRewardProgramHandler = artifacts.require("LockRewardProgramHandler");
const UpdateRewardProgramAdminHandler = artifacts.require(
  "UpdateRewardProgramAdminHandler"
);
const AddRewardRuleHandler = artifacts.require("AddRewardRuleHandler");
const RemoveRewardRuleHandler = artifacts.require("RemoveRewardRuleHandler");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const GAS_FEE_RECEIVER = process.env.GAS_FEE_RECEIVER ?? ZERO_ADDRESS;
const GAS_FEE_CARD_WEI = String(
  process.env.GAS_FEE_CARD_WEI ?? 1000000000000000000
);
const RATE_DRIFT_PERCENTAGE = process.env.RATE_DRIFT_PERCENTAGE ?? 125000; // 0.125%
const MERCHANT_FEE_PERCENTAGE = process.env.MERCHANT_FEE_PERCENTAGE ?? 500000; // 0.5%
const MERCHANT_REGISTRATION_FEE_IN_SPEND =
  process.env.MERCHANT_REGISTRATION_FEE_IN_SPEND ?? 100;
const MERCHANT_FEE_RECEIVER = process.env.MERCHANT_FEE_RECEIVER ?? ZERO_ADDRESS;
const BRIDGE_MEDIATOR = process.env.BRIDGE_MEDIATOR ?? ZERO_ADDRESS;
const PAYABLE_TOKENS = process.env.PAYABLE_TOKENS
  ? process.env.PAYABLE_TOKENS.split(",").map((t) => t.trim())
  : [];
const GAS_TOKEN = process.env.GAS_TOKEN ?? ZERO_ADDRESS;
const GNOSIS_SAFE_MASTER_COPY =
  process.env.GNOSIS_SAFE_MASTER_COPY ??
  "0x6851D6fDFAfD08c0295C392436245E5bc78B0185";
const GNOSIS_SAFE_FACTORY =
  process.env.GNOSIS_SAFE_FACTORY ??
  "0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B";
const MINIMUM_AMOUNT = process.env.MINIMUM_AMOUNT ?? "100"; // minimum face value (in SPEND) for new prepaid card
const MAXIMUM_AMOUNT = process.env.MAXIMUM_AMOUNT ?? "100000"; // maximum face value (in SPEND) for new prepaid card
const TALLY = process.env.TALLY ?? ZERO_ADDRESS;

const REWARD_FEE_RECEIVER = process.env.REWARD_FEE_RECEIVER ?? ZERO_ADDRESS;
const REWARDEE_REGISTRATION_FEE_IN_SPEND =
  process.env.REWARDEE_REGISTRATION_FEE_IN_SPEND ?? 500;
const REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND =
  process.env.REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND ?? 500;

module.exports = async function (_deployer, network) {
  if (["ganache", "test", "soliditycoverage"].includes(network)) {
    return;
  }
  // TODO after the next deploy with these addresses we can just use zero
  // address for this
  const deprecatedMerchantManager =
    network === "xdai"
      ? "0x3C29B2A563F4bB9D625175bE823c528A4Ddd1107" // v0.6.4+xdai
      : "0xA113ECa0Af275e1906d1fe1B7Bef1dDB033113E2"; // v0.6.7+sokol

  const addressesFile = resolve(
    __dirname,
    "..",
    ".openzeppelin",
    `addresses-${network}.json`
  );
  if (!existsSync(addressesFile)) {
    throw new Error(`Cannot read from the addresses file ${addressesFile}`);
  }
  let proxyAddresses = readJSONSync(addressesFile);

  let revenuePoolAddress = getAddress("RevenuePool", proxyAddresses);
  let prepaidCardManagerAddress = getAddress(
    "PrepaidCardManager",
    proxyAddresses
  );
  let exchangeAddress = getAddress("Exchange", proxyAddresses);
  let tokenManagerAddress = getAddress("TokenManager", proxyAddresses);
  let merchantManagerAddress = getAddress("MerchantManager", proxyAddresses);
  let supplierManagerAddress = getAddress("SupplierManager", proxyAddresses);
  let actionDispatcherAddress = getAddress("ActionDispatcher", proxyAddresses);
  let payMerchantHandlerAddress = getAddress(
    "PayMerchantHandler",
    proxyAddresses
  );
  let registerMerchantHandlerAddress = getAddress(
    "RegisterMerchantHandler",
    proxyAddresses
  );
  let splitPrepaidCardHandlerAddress = getAddress(
    "SplitPrepaidCardHandler",
    proxyAddresses
  );
  let transferPrepaidCardHandlerAddress = getAddress(
    "TransferPrepaidCardHandler",
    proxyAddresses
  );
  let spendTokenAddress = getAddress("SPEND", proxyAddresses);
  let daiOracleAddress = getAddress("DAIOracle", proxyAddresses);
  let cardOracleAddress = getAddress("CARDOracle", proxyAddresses);
  let bridgeUtilsAddress = getAddress("BridgeUtils", proxyAddresses);
  let rewardPoolAddress = getAddress("RewardPool", proxyAddresses);
  let rewardManagerAddress = getAddress("RewardManager", proxyAddresses);

  let registerRewardProgramHandlerAddress = getAddress(
    "RegisterRewardProgramHandler",
    proxyAddresses
  );
  let registerRewardeeHandlerAddress = getAddress(
    "RegisterRewardeeHandler",
    proxyAddresses
  );
  let lockRewardProgramHandlerAddress = getAddress(
    "LockRewardProgramHandler",
    proxyAddresses
  );
  let updateRewardProgramAdminHandlerAddress = getAddress(
    "UpdateRewardProgramAdminHandler",
    proxyAddresses
  );
  let addRewardRuleHandlerAddress = getAddress(
    "AddRewardRuleHandler",
    proxyAddresses
  );
  let removeRewardRuleHandlerAddress = getAddress(
    "RemoveRewardRuleHandler",
    proxyAddresses
  );

  // RevenuePool configuration
  let revenuePool = await RevenuePool.at(revenuePoolAddress);
  console.log(`
==================================================
Configuring RevenuePool ${revenuePoolAddress}
  Exchange address: ${exchangeAddress}
  MerchantManager address: ${merchantManagerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  merchant fee receiver: ${MERCHANT_FEE_RECEIVER}
  merchant fee percentage: ${(
    Number(MERCHANT_FEE_PERCENTAGE) / 1000000
  ).toFixed(4)}%
  merchant registration fee: §${MERCHANT_REGISTRATION_FEE_IN_SPEND} SPEND`);
  await sendTx(() =>
    revenuePool.setup(
      exchangeAddress,
      merchantManagerAddress,
      actionDispatcherAddress,
      prepaidCardManagerAddress,
      MERCHANT_FEE_RECEIVER,
      MERCHANT_FEE_PERCENTAGE,
      MERCHANT_REGISTRATION_FEE_IN_SPEND
    )
  );

  // Token Manager configuration
  let tokenManager = await TokenManager.at(tokenManagerAddress);
  console.log(`
==================================================
Configuring TokenManager ${tokenManagerAddress}
  BridgeUtils address: ${bridgeUtilsAddress}
  payable tokens: ${PAYABLE_TOKENS.join(", ")}`);
  await sendTx(() => tokenManager.setup(bridgeUtilsAddress, PAYABLE_TOKENS));

  // Merchant Manager configuration
  let merchantManager = await MerchantManager.at(merchantManagerAddress);
  console.log(`
==================================================
Configuring MerchantManager ${merchantManagerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}
  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}
  DeprecatedMerchantManager: ${deprecatedMerchantManager}`);
  await sendTx(() =>
    merchantManager.setup(
      actionDispatcherAddress,
      GNOSIS_SAFE_MASTER_COPY,
      GNOSIS_SAFE_FACTORY,
      deprecatedMerchantManager
    )
  );

  // Supplier Manager configuration
  let supplierManager = await SupplierManager.at(supplierManagerAddress);
  console.log(`
==================================================
Configuring SupplierManager ${supplierManagerAddress}
  BridgeUtils address: ${bridgeUtilsAddress}
  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}
  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}
`);
  await sendTx(() =>
    supplierManager.setup(
      bridgeUtilsAddress,
      GNOSIS_SAFE_MASTER_COPY,
      GNOSIS_SAFE_FACTORY
    )
  );

  // Exchange configuration
  let exchange = await Exchange.at(exchangeAddress);
  console.log(`
==================================================
Configuring Exchange ${exchangeAddress}
  rate drift percentage: ${(Number(RATE_DRIFT_PERCENTAGE) / 1000000).toFixed(
    4
  )}%`);
  await sendTx(() => exchange.setup(RATE_DRIFT_PERCENTAGE));

  console.log(`  set DAI oracle to ${daiOracleAddress}`);
  await sendTx(() => exchange.createExchange("DAI", daiOracleAddress));
  console.log(`  set CARD oracle to ${cardOracleAddress}`);
  await sendTx(() => exchange.createExchange("CARD", cardOracleAddress));

  // ActionDispatcher configuration
  let actionDispatcher = await ActionDispatcher.at(actionDispatcherAddress);
  console.log(`
==================================================
Configuring ActionDispatcher ${actionDispatcherAddress}
  TokenManager address: ${tokenManagerAddress}
  Exchange address: ${exchangeAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}`);
  await sendTx(() =>
    actionDispatcher.setup(
      tokenManagerAddress,
      exchangeAddress,
      prepaidCardManagerAddress
    )
  );
  console.log(
    `  adding action handler for "payMerchant": ${payMerchantHandlerAddress}`
  );
  await sendTx(() =>
    actionDispatcher.addHandler(payMerchantHandlerAddress, "payMerchant")
  );
  console.log(
    `  adding action handler for "registerMerchant": ${registerMerchantHandlerAddress}`
  );
  await sendTx(() =>
    actionDispatcher.addHandler(
      registerMerchantHandlerAddress,
      "registerMerchant"
    )
  );
  console.log(
    `  adding action handler for "split": ${splitPrepaidCardHandlerAddress}`
  );
  await sendTx(() =>
    actionDispatcher.addHandler(splitPrepaidCardHandlerAddress, "split")
  );
  console.log(
    `  adding action handler for "transfer": ${transferPrepaidCardHandlerAddress}`
  );
  await sendTx(() =>
    actionDispatcher.addHandler(transferPrepaidCardHandlerAddress, "transfer")
  );

  // PayMerchantHandler configuration
  let payMerchantHandler = await PayMerchantHandler.at(
    payMerchantHandlerAddress
  );
  console.log(`
==================================================
Configuring PayMerchantHandler ${payMerchantHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  MerchantManager address: ${merchantManagerAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  Revenue Pool Address: ${revenuePoolAddress}
  SPEND token address: ${spendTokenAddress}
  TokenManager address: ${tokenManagerAddress}`);
  await sendTx(() =>
    payMerchantHandler.setup(
      actionDispatcherAddress,
      merchantManagerAddress,
      prepaidCardManagerAddress,
      revenuePoolAddress,
      spendTokenAddress,
      tokenManagerAddress
    )
  );

  // RegisterMerchantHandler configuration
  let registerMerchantHandler = await RegisterMerchantHandler.at(
    registerMerchantHandlerAddress
  );
  console.log(`
==================================================
Configuring RegisterMerchantHandler ${registerMerchantHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  MerchantManager address: ${merchantManagerAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  Revenue Pool Address: ${revenuePoolAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}`);
  await sendTx(() =>
    registerMerchantHandler.setup(
      actionDispatcherAddress,
      merchantManagerAddress,
      prepaidCardManagerAddress,
      revenuePoolAddress,
      exchangeAddress,
      tokenManagerAddress
    )
  );

  // SplitPrepaidCardHandler configuration
  let splitPrepaidCardHandler = await SplitPrepaidCardHandler.at(
    splitPrepaidCardHandlerAddress
  );
  console.log(`
==================================================
Configuring SplitPrepaidCardHandler ${splitPrepaidCardHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  TokenManager address: ${tokenManagerAddress}`);
  await sendTx(() =>
    splitPrepaidCardHandler.setup(
      actionDispatcherAddress,
      prepaidCardManagerAddress,
      tokenManagerAddress
    )
  );

  // TransferPrepaidCardHandler configuration
  let transferPrepaidCardHandler = await TransferPrepaidCardHandler.at(
    transferPrepaidCardHandlerAddress
  );
  console.log(`
==================================================
Configuring TransferPrepaidCardHandler ${transferPrepaidCardHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  TokenManager address: ${tokenManagerAddress}`);
  await sendTx(() =>
    transferPrepaidCardHandler.setup(
      actionDispatcherAddress,
      prepaidCardManagerAddress,
      tokenManagerAddress
    )
  );

  // PrepaidCardManager configuration
  let prepaidCardManager = await PrepaidCardManager.at(
    prepaidCardManagerAddress
  );
  console.log(`
==================================================
Configuring PrepaidCardManager ${prepaidCardManagerAddress}
  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}
  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}
  ActionDispatcher address: ${actionDispatcherAddress}
  TokenManager address: ${tokenManagerAddress}
  SupplierManager address: ${supplierManagerAddress}
  Exchange address: ${exchangeAddress}
  gas fee receiver: ${GAS_FEE_RECEIVER}
  gas fee: ${fromWei(GAS_FEE_CARD_WEI)} CARD
  gas token: ${GAS_TOKEN}
  minimum face value: ${MINIMUM_AMOUNT}
  maximum face value: ${MAXIMUM_AMOUNT}`);
  await sendTx(() =>
    prepaidCardManager.setup(
      tokenManagerAddress,
      supplierManagerAddress,
      exchangeAddress,
      GNOSIS_SAFE_MASTER_COPY,
      GNOSIS_SAFE_FACTORY,
      actionDispatcherAddress,
      GAS_FEE_RECEIVER,
      GAS_FEE_CARD_WEI,
      GAS_TOKEN,
      MINIMUM_AMOUNT,
      MAXIMUM_AMOUNT
    )
  );
  console.log(
    `  setting gas policy for "transfer" to *not* use issuing token for gas and to pay gas recipient`
  );
  await sendTx(() => prepaidCardManager.addGasPolicy("transfer", false, true));
  console.log(
    `  setting gas policy for "split" to use issuing token for gas and to pay gas recipient`
  );
  await sendTx(() => prepaidCardManager.addGasPolicy("split", true, true));

  // RewardPool configuration
  let rewardPool = await RewardPool.at(rewardPoolAddress);
  console.log(`
==================================================
Configuring RewardPool ${rewardPoolAddress}
  tally ${TALLY}`);
  await sendTx(() => rewardPool.setup(TALLY));

  // BridgeUtils configuration
  let bridgeUtils = await BridgeUtils.at(bridgeUtilsAddress);
  console.log(`
==================================================
Configuring BridgeUtils ${bridgeUtilsAddress}
  TokenManager address: ${tokenManagerAddress}
  SupplierManager address: ${supplierManagerAddress}
  Exchange address: ${exchangeAddress}
  bridge mediator address: ${BRIDGE_MEDIATOR}`);
  await sendTx(() =>
    bridgeUtils.setup(
      tokenManagerAddress,
      supplierManagerAddress,
      exchangeAddress,
      BRIDGE_MEDIATOR
    )
  );

  // SPEND configuration
  let spend = await SPEND.at(spendTokenAddress);
  console.log(`
==================================================
Configuring SPEND: ${spendTokenAddress}
  adding minter: ${payMerchantHandlerAddress} (PayMerchantHandler)`);
  await sendTx(() => spend.addMinter(payMerchantHandlerAddress));

  let rewardManager = await RewardManager.at(rewardManagerAddress);
  console.log(`
==================================================
Configuring RewardManager ${rewardManagerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  gnosis master copy: ${GNOSIS_SAFE_MASTER_COPY}
  gnosis proxy factory: ${GNOSIS_SAFE_FACTORY}
  reward fee receiver: ${MERCHANT_FEE_RECEIVER}
  rewardee registration fee: §${MERCHANT_REGISTRATION_FEE_IN_SPEND} SPEND`);
  await sendTx(() =>
    rewardManager.setup(
      actionDispatcherAddress,
      GNOSIS_SAFE_MASTER_COPY,
      GNOSIS_SAFE_FACTORY,
      REWARD_FEE_RECEIVER,
      REWARDEE_REGISTRATION_FEE_IN_SPEND,
      REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND
    )
  );

  let registerRewardProgramHandler = await RegisterRewardProgramHandler.at(
    registerRewardProgramHandlerAddress
  );
  console.log(`
==================================================
Configuring RegisterRewardProgramHandler ${registerRewardProgramHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    registerRewardProgramHandler.setup(
      actionDispatcherAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );

  let registerRewardeeHandler = await RegisterRewardeeHandler.at(
    registerRewardeeHandlerAddress
  );
  console.log(`
==================================================
Configuring RegisterRewardeeHandler ${registerRewardeeHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    registerRewardeeHandler.setup(
      actionDispatcherAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );

  let lockRewardProgramHandler = await LockRewardProgramHandler.at(
    lockRewardProgramHandlerAddress
  );
  console.log(`
==================================================
Configuring LockRewardProgramHandler ${lockRewardProgramHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    lockRewardProgramHandler.setup(
      actionDispatcherAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );

  let updateRewardProgramAdminHandler = await UpdateRewardProgramAdminHandler.at(
    updateRewardProgramAdminHandlerAddress
  );
  console.log(`
==================================================
Configuring UpdateRewardProgramAdminHandler ${updateRewardProgramAdminHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    updateRewardProgramAdminHandler.setup(
      actionDispatcherAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );

  let addRewardRuleHandler = await AddRewardRuleHandler.at(
    addRewardRuleHandlerAddress
  );
  console.log(`
==================================================
Configuring AddRewardRule ${addRewardRuleHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    addRewardRuleHandler.setup(
      actionDispatcherAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );

  let removeRewardRuleHandler = await RemoveRewardRuleHandler.at(
    removeRewardRuleHandlerAddress
  );
  console.log(`
==================================================
Configuring RemoveRewardRule ${removeRewardRuleHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    removeRewardRuleHandler.setup(
      actionDispatcherAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );
};

function getAddress(contractId, addresses) {
  let info = addresses[contractId];
  if (!info?.proxy) {
    throw new Error(
      `Cannot find proxy address for ${contractId} in addresses file`
    );
  }
  return info.proxy;
}
