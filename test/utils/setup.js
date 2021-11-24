const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const SPEND = artifacts.require("SPEND.sol");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const RewardManager = artifacts.require("RewardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const MerchantManager = artifacts.require("MerchantManager");
const ERC677Token = artifacts.require("ERC677Token.sol");
const RewardPool = artifacts.require("RewardPool.sol");
const RewardSafeDelegateImplementation = artifacts.require(
  "RewardSafeDelegateImplementation"
);

const { TOKEN_DETAIL_DATA } = require("../setup");

const {
  toTokenUnit,
  setupExchanges,
  addActionHandlers,
  createDepotFromSupplierMgr,
  setupVersionManager,
} = require("./helper");

//constants
const REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND = 500;

const utils = require("./general");
const { ZERO_ADDRESS } = require("./general");

// TODO: must make sure there is no collision in accounts for different test
const setupRoles = function (accounts) {
  return {
    owner: accounts[0],
    tally: accounts[1],
    issuer: accounts[2],
    rewardProgramAdmin: accounts[3],
    prepaidCardOwner: accounts[4],
    relayer: accounts[5],
    merchantFeeReceiver: accounts[5],
    rewardFeeReceiver: accounts[6],
    otherPrepaidCardOwner: accounts[7],
    governanceAdmin: accounts[8],
  };
};

// this is bad but I use as placeholder because it greedily loads all contracts
const setupProtocol = async (accounts) => {
  const {
    owner,
    issuer,
    merchantFeeReceiver,
    rewardFeeReceiver,
    tally,
    governanceAdmin,
  } = setupRoles(accounts);

  const proxyFactory = await ProxyFactory.new();
  const gnosisSafeMasterCopy = await utils.deployContract(
    "deploying Gnosis Safe Mastercopy",
    GnosisSafe
  );
  const versionManager = await setupVersionManager(owner);
  const revenuePool = await RevenuePool.new();
  await revenuePool.initialize(owner);
  const prepaidCardManager = await PrepaidCardManager.new();
  await prepaidCardManager.initialize(owner);
  const supplierManager = await SupplierManager.new();
  await supplierManager.initialize(owner);
  const spendToken = await SPEND.new();
  await spendToken.initialize(owner);
  const actionDispatcher = await ActionDispatcher.new();
  await actionDispatcher.initialize(owner);
  let tokenManager = await TokenManager.new();
  await tokenManager.initialize(owner);
  const merchantManager = await MerchantManager.new();
  await merchantManager.initialize(owner);
  const rewardManager = await RewardManager.new();
  await rewardManager.initialize(owner);
  const rewardPool = await RewardPool.new();
  await rewardPool.initialize(owner);

  const { daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner);

  // setup
  await tokenManager.setup(
    ZERO_ADDRESS,
    [daicpxdToken.address, cardcpxdToken.address],
    versionManager.address
  );
  await supplierManager.setup(
    ZERO_ADDRESS,
    gnosisSafeMasterCopy.address,
    proxyFactory.address,
    versionManager.address
  );
  await merchantManager.setup(
    actionDispatcher.address,
    gnosisSafeMasterCopy.address,
    proxyFactory.address,
    versionManager.address
  );
  await prepaidCardManager.setup(
    tokenManager.address,
    supplierManager.address,
    exchange.address,
    gnosisSafeMasterCopy.address,
    proxyFactory.address,
    actionDispatcher.address,
    ZERO_ADDRESS,
    0,
    100,
    500000,
    [],
    versionManager.address
  );
  await revenuePool.setup(
    exchange.address,
    merchantManager.address,
    actionDispatcher.address,
    prepaidCardManager.address,
    merchantFeeReceiver,
    0,
    1000,
    versionManager.address
  );
  let rewardSafeDelegate = await RewardSafeDelegateImplementation.new();

  await rewardManager.setup(
    actionDispatcher.address,
    gnosisSafeMasterCopy.address,
    proxyFactory.address,
    rewardFeeReceiver,
    REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
    [rewardPool.address],
    versionManager.address,
    governanceAdmin,
    rewardSafeDelegate.address
  );
  await rewardPool.setup(
    tally,
    rewardManager.address,
    tokenManager.address,
    versionManager.address
  );

  await prepaidCardManager.addGasPolicy("transfer", false);
  await prepaidCardManager.addGasPolicy("split", true);
  await prepaidCardManager.addGasPolicy("registerRewardProgram", false);
  await prepaidCardManager.addGasPolicy("registerRewardee", true);
  await prepaidCardManager.addGasPolicy("lockRewardProgram", true);
  await prepaidCardManager.addGasPolicy("updateRewardProgramAdmin", true);
  await prepaidCardManager.addGasPolicy("addRewardRule", true);
  await prepaidCardManager.addGasPolicy("payRewardTokens", true);

  await actionDispatcher.setup(
    tokenManager.address,
    exchange.address,
    prepaidCardManager.address,
    versionManager.address
  );

  let { payRewardTokensHandler } = await addActionHandlers({
    prepaidCardManager,
    revenuePool,
    actionDispatcher,
    merchantManager,
    tokenManager,
    rewardManager,
    owner,
    exchangeAddress: exchange.address,
    spendAddress: spendToken.address,
    rewardPool,
    versionManager,
  });

  await daicpxdToken.mint(owner, toTokenUnit(100));

  //safes
  const depot = await createDepotFromSupplierMgr(supplierManager, issuer);
  await daicpxdToken.mint(depot.address, toTokenUnit(1000));
  await cardcpxdToken.mint(depot.address, toTokenUnit(1000));

  const fakeDaicpxdToken = await ERC677Token.new();
  await fakeDaicpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
  await fakeDaicpxdToken.mint(owner, toTokenUnit(1000));
  return {
    //safe contracts
    proxyFactory,
    gnosisSafeMasterCopy,

    //protocol contracts
    prepaidCardManager,
    tokenManager,
    supplierManager,
    merchantManager,
    rewardManager,
    revenuePool,
    actionDispatcher,
    exchange,
    spendToken,
    rewardPool,
    payRewardTokensHandler,
    versionManager,

    //tokens
    daicpxdToken,
    cardcpxdToken,
    fakeDaicpxdToken,

    //safes
    depot,
  };
};

exports.setupProtocol = setupProtocol;
exports.setupRoles = setupRoles;
