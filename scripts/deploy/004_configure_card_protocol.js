const { readJSONSync, existsSync } = require("node-fs-extra");
const { resolve } = require("path");
const Web3 = require("web3");
const { fromWei } = Web3.utils;

const hre = require("hardhat");
const {
  makeFactory,
  patchNetworks,
  asyncMain,
  getDeployAddress
} = require("./util");
patchNetworks();

const retry = require("async-retry");
const sendTx = async function (cb) {
  return await retry(cb, { retries: 3 });
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const GAS_FEE_RECEIVER = process.env.GAS_FEE_RECEIVER ?? ZERO_ADDRESS;
const GAS_FEE_CARD_WEI = String(
  process.env.GAS_FEE_CARD_WEI ?? 1000000000000000000
);
const RATE_DRIFT_PERCENTAGE = process.env.RATE_DRIFT_PERCENTAGE ?? 125000; // 0.125%
const MERCHANT_FEE_PERCENTAGE = process.env.MERCHANT_FEE_PERCENTAGE ?? 500000; // 0.5%
const MERCHANT_REGISTRATION_FEE_IN_SPEND =
  process.env.MERCHANT_REGISTRATION_FEE_IN_SPEND ?? 100;
  
const BRIDGE_MEDIATOR = process.env.BRIDGE_MEDIATOR ?? ZERO_ADDRESS;
const PAYABLE_TOKENS = process.env.PAYABLE_TOKENS
  ? process.env.PAYABLE_TOKENS.split(",").map(t => t.trim())
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
const TALLY = process.env.TALLY ?? "0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B";

const REWARDEE_REGISTRATION_FEE_IN_SPEND =
  process.env.REWARDEE_REGISTRATION_FEE_IN_SPEND ?? 500;
const REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND =
  process.env.REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND ?? 500;

async function main() {
  const RevenuePool = await makeFactory("RevenuePool");
  const PrepaidCardManager = await makeFactory("PrepaidCardManager");
  const BridgeUtils = await makeFactory("BridgeUtils");
  const SPEND = await makeFactory("SPEND");
  const RewardPool = await makeFactory("RewardPool");
  const Exchange = await makeFactory("Exchange");
  const PayMerchantHandler = await makeFactory("PayMerchantHandler");
  const RegisterMerchantHandler = await makeFactory("RegisterMerchantHandler");
  const SplitPrepaidCardHandler = await makeFactory("SplitPrepaidCardHandler");
  const TransferPrepaidCardHandler = await makeFactory(
    "TransferPrepaidCardHandler"
  );
  const ActionDispatcher = await makeFactory("ActionDispatcher");
  const TokenManager = await makeFactory("TokenManager");
  const SupplierManager = await makeFactory("SupplierManager");
  const MerchantManager = await makeFactory("MerchantManager");
  const RewardManager = await makeFactory("RewardManager");
  const RegisterRewardProgramHandler = await makeFactory(
    "RegisterRewardProgramHandler"
  );
  const RegisterRewardeeHandler = await makeFactory("RegisterRewardeeHandler");
  const LockRewardProgramHandler = await makeFactory(
    "LockRewardProgramHandler"
  );
  const UpdateRewardProgramAdminHandler = await makeFactory(
    "UpdateRewardProgramAdminHandler"
  );
  const AddRewardRuleHandler = await makeFactory("AddRewardRuleHandler");
  const RemoveRewardRuleHandler = await makeFactory("RemoveRewardRuleHandler");
  const PayRewardTokensHandler = await makeFactory("PayRewardTokensHandler");

  const {
    network: { name: network }
  } = hre;

  let deployer = await getDeployAddress();

  const MERCHANT_FEE_RECEIVER = process.env.MERCHANT_FEE_RECEIVER ?? deployer;
  const REWARD_FEE_RECEIVER = process.env.REWARD_FEE_RECEIVER ?? deployer;

  // TODO after the next deploy with these addresses we can just use zero
  // address for this
  const deprecatedMerchantManager =
    network === "xdai"
      ? "0x3C29B2A563F4bB9D625175bE823c528A4Ddd1107" // v0.6.4+xdai
      : "0xA113ECa0Af275e1906d1fe1B7Bef1dDB033113E2"; // v0.6.7+sokol

  const addressesFile = resolve(
    __dirname,
    "..",
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
  let payRewardTokensHandlerAddress = getAddress(
    "PayRewardTokensHandler",
    proxyAddresses
  );

  // RevenuePool configuration
  let revenuePool = await RevenuePool.attach(revenuePoolAddress);
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
  let tokenManager = await TokenManager.attach(tokenManagerAddress);
  console.log(`
==================================================
Configuring TokenManager ${tokenManagerAddress}
  BridgeUtils address: ${bridgeUtilsAddress}
  payable tokens: ${PAYABLE_TOKENS.join(", ")}`);
  await sendTx(() => tokenManager.setup(bridgeUtilsAddress, PAYABLE_TOKENS));

  // Merchant Manager configuration
  let merchantManager = await MerchantManager.attach(merchantManagerAddress);
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
  let supplierManager = await SupplierManager.attach(supplierManagerAddress);
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
  let exchange = await Exchange.attach(exchangeAddress);
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

  async function actionDispatcher() {
    return await ActionDispatcher.attach(actionDispatcherAddress);
  }
  console.log(`
==================================================
Configuring ActionDispatcher ${actionDispatcherAddress}
  TokenManager address: ${tokenManagerAddress}
  Exchange address: ${exchangeAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}`);
  await sendTx(async () =>
    (await actionDispatcher()).setup(
      tokenManagerAddress,
      exchangeAddress,
      prepaidCardManagerAddress
    )
  );
  console.log(
    `  adding action handler for "payMerchant": ${payMerchantHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      payMerchantHandlerAddress,
      "payMerchant"
    )
  );
  console.log(
    `  adding action handler for "registerMerchant": ${registerMerchantHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      registerMerchantHandlerAddress,
      "registerMerchant"
    )
  );
  console.log(
    `  adding action handler for "split": ${splitPrepaidCardHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      splitPrepaidCardHandlerAddress,
      "split"
    )
  );
  console.log(
    `  adding action handler for "transfer": ${transferPrepaidCardHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      transferPrepaidCardHandlerAddress,
      "transfer"
    )
  );
  console.log(
    `  adding action handler for "registerRewardee": ${registerRewardeeHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      registerRewardeeHandlerAddress,
      "registerRewardee"
    )
  );

  console.log(
    `  adding action handler for "registerRewardProgram": ${registerRewardProgramHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      registerRewardProgramHandlerAddress,
      "registerRewardProgram"
    )
  );

  console.log(
    `  adding action handler for "lockRewardProgram": ${lockRewardProgramHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      lockRewardProgramHandlerAddress,
      "lockRewardProgram"
    )
  );

  console.log(
    `  adding action handler for "addRewardRule": ${addRewardRuleHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      addRewardRuleHandlerAddress,
      "addRewardRule"
    )
  );

  console.log(
    `  adding action handler for "removeRewardRule": ${removeRewardRuleHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      removeRewardRuleHandlerAddress,
      "removeRewardRule"
    )
  );

  console.log(
    `  adding action handler for "updateRewardProgramAdmin": ${updateRewardProgramAdminHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      updateRewardProgramAdminHandlerAddress,
      "updateRewardProgramAdmin"
    )
  );

  console.log(
    `  adding action handler for "payRewardTokens": ${payRewardTokensHandlerAddress}`
  );
  await sendTx(async () =>
    (await actionDispatcher()).addHandler(
      payRewardTokensHandlerAddress,
      "payRewardTokens"
    )
  );

  // PayMerchantHandler configuration
  let payMerchantHandler = await PayMerchantHandler.attach(
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
  let registerMerchantHandler = await RegisterMerchantHandler.attach(
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
  let splitPrepaidCardHandler = await SplitPrepaidCardHandler.attach(
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
  let transferPrepaidCardHandler = await TransferPrepaidCardHandler.attach(
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
  async function prepaidCardManager() {
    return await PrepaidCardManager.attach(prepaidCardManagerAddress);
  }
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
  await sendTx(async () =>
    (await prepaidCardManager()).setup(
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
  await sendTx(async () => (await prepaidCardManager()).addGasPolicy("transfer", false, true));
  console.log(
    `  setting gas policy for "split" to use issuing token for gas and to pay gas recipient`
  );
  await sendTx(async () => (await prepaidCardManager()).addGasPolicy("split", true, true));
  console.log(
    `  setting gas policy for "registerRewardProgram" to use issuing token for gas and to pay gas recipient`
  );
  await sendTx(async () =>
    (await prepaidCardManager()).addGasPolicy("registerRewardProgram", true, true)
  );
  console.log(
    `  setting gas policy for "registerRewardee" to use issuing token for gas and to pay gas recipient`
  );
  await sendTx(async () =>
    (await prepaidCardManager()).addGasPolicy("registerRewardee", true, true)
  );
  console.log(
    `  setting gas policy for "lockRewardProgram" to use issuing token for gas and to pay gas recipient`
  );
  await sendTx(async () =>
    (await prepaidCardManager()).addGasPolicy("lockRewardProgram", true, true)
  );
  console.log(
    `  setting gas policy for "updateRewardProgramAdmin" to use issuing token for gas and to pay gas recipient`
  );
  await sendTx(async () =>
    (await prepaidCardManager()).addGasPolicy("updateRewardProgramAdmin", true, true)
  );
  console.log(
    `  setting gas policy for "addRewardRule" to use issuing token for gas and to pay gas recipient`
  );
  await sendTx(async () =>
    (await prepaidCardManager()).addGasPolicy("addRewardRule", true, true)
  );
  console.log(
    `  setting gas policy for "removeRewardRule" to use issuing token for gas and to pay gas recipient`
  );
  await sendTx(async () =>
    (await prepaidCardManager()).addGasPolicy("removeRewardRule", true, true)
  );

  // RewardPool configuration
  let rewardPool = await RewardPool.attach(rewardPoolAddress);
  console.log(`
==================================================
Configuring RewardPool ${rewardPoolAddress}
  tally ${TALLY}`);
  await sendTx(() => rewardPool.setup(TALLY, rewardManagerAddress));

  // BridgeUtils configuration
  let bridgeUtils = await BridgeUtils.attach(bridgeUtilsAddress);
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
  let spend = await SPEND.attach(spendTokenAddress);
  console.log(`
==================================================
Configuring SPEND: ${spendTokenAddress}
  adding minter: ${payMerchantHandlerAddress} (PayMerchantHandler)`);
  await sendTx(() => spend.addMinter(payMerchantHandlerAddress));

  let rewardManager = await RewardManager.attach(rewardManagerAddress);
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

  let registerRewardProgramHandler = await RegisterRewardProgramHandler.attach(
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

  let registerRewardeeHandler = await RegisterRewardeeHandler.attach(
    registerRewardeeHandlerAddress
  );
  console.log(`
==================================================
Configuring RegisterRewardeeHandler ${registerRewardeeHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    registerRewardeeHandler.setup(
      actionDispatcherAddress,
      prepaidCardManagerAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );

  let lockRewardProgramHandler = await LockRewardProgramHandler.attach(
    lockRewardProgramHandlerAddress
  );
  console.log(`
==================================================
Configuring LockRewardProgramHandler ${lockRewardProgramHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    lockRewardProgramHandler.setup(
      actionDispatcherAddress,
      prepaidCardManagerAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );

  let updateRewardProgramAdminHandler = await UpdateRewardProgramAdminHandler.attach(
    updateRewardProgramAdminHandlerAddress
  );
  console.log(`
==================================================
Configuring UpdateRewardProgramAdminHandler ${updateRewardProgramAdminHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    updateRewardProgramAdminHandler.setup(
      actionDispatcherAddress,
      prepaidCardManagerAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );

  let addRewardRuleHandler = await AddRewardRuleHandler.attach(
    addRewardRuleHandlerAddress
  );
  console.log(`
==================================================
Configuring AddRewardRule ${addRewardRuleHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    addRewardRuleHandler.setup(
      actionDispatcherAddress,
      prepaidCardManagerAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );

  let removeRewardRuleHandler = await RemoveRewardRuleHandler.attach(
    removeRewardRuleHandlerAddress
  );
  console.log(`
==================================================
Configuring RemoveRewardRule ${removeRewardRuleHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  PrepaidCardManager address: ${prepaidCardManagerAddress}
  Exchange address: ${exchangeAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardManager address: ${rewardManagerAddress}
  `);
  await sendTx(() =>
    removeRewardRuleHandler.setup(
      actionDispatcherAddress,
      prepaidCardManagerAddress,
      exchangeAddress,
      tokenManagerAddress,
      rewardManagerAddress
    )
  );


  let payRewardTokensHandler = await PayRewardTokensHandler.attach(
    payRewardTokensHandlerAddress
  );
  console.log(`
==================================================
Configuring PayRewardTokens ${payRewardTokensHandlerAddress}
  ActionDispatcher address: ${actionDispatcherAddress}
  TokenManager address: ${tokenManagerAddress}
  RewardPool address: ${rewardPoolAddress}
  `);
  await sendTx(() =>
    payRewardTokensHandler.setup(
      actionDispatcherAddress,
      tokenManagerAddress,
      rewardPoolAddress
    )
  );
}

function getAddress(contractId, addresses) {
  let info = addresses[contractId];
  if (!info?.proxy) {
    throw new Error(
      `Cannot find proxy address for ${contractId} in addresses file`
    );
  }
  return info.proxy;
}

asyncMain(main);
