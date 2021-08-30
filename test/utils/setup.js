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
const { TOKEN_DETAIL_DATA } = require("../setup");

const {
  toTokenUnit,
  setupExchanges,
  addActionHandlers,
  createDepotFromSupplierMgr,
} = require("./helper");

//constants
const REWARDEE_REGISTRATION_FEE_IN_SPEND = 500;
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
  } = setupRoles(accounts);

  const proxyFactory = await ProxyFactory.new();
  const gnosisSafeMasterCopy = await utils.deployContract(
    "deploying Gnosis Safe Mastercopy",
    GnosisSafe
  );
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
  await tokenManager.setup(ZERO_ADDRESS, [
    daicpxdToken.address,
    cardcpxdToken.address,
  ]);
  await supplierManager.setup(
    ZERO_ADDRESS,
    gnosisSafeMasterCopy.address,
    proxyFactory.address
  );
  await merchantManager.setup(
    actionDispatcher.address,
    gnosisSafeMasterCopy.address,
    proxyFactory.address,
    ZERO_ADDRESS
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
    cardcpxdToken.address,
    100,
    500000
  );
  await revenuePool.setup(
    exchange.address,
    merchantManager.address,
    actionDispatcher.address,
    prepaidCardManager.address,
    merchantFeeReceiver,
    0,
    1000
  );
  await rewardManager.setup(
    actionDispatcher.address,
    gnosisSafeMasterCopy.address,
    proxyFactory.address,
    rewardFeeReceiver,
    REWARDEE_REGISTRATION_FEE_IN_SPEND,
    REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND
  );
  await rewardPool.setup(tally, rewardManager.address, tokenManager.address);

  await prepaidCardManager.addGasPolicy("transfer", false, true);
  await prepaidCardManager.addGasPolicy("split", true, true);
  await prepaidCardManager.addGasPolicy("registerRewardProgram", true, true);
  await prepaidCardManager.addGasPolicy("registerRewardee", true, true);
  await prepaidCardManager.addGasPolicy("lockRewardProgram", true, true);
  await prepaidCardManager.addGasPolicy("updateRewardProgramAdmin", true, true);
  await prepaidCardManager.addGasPolicy("addRewardRule", true, true);
  await prepaidCardManager.addGasPolicy("removeRewardRule", true, true);
  await prepaidCardManager.addGasPolicy("payRewardTokens", true, true);

  await actionDispatcher.setup(
    tokenManager.address,
    exchange.address,
    prepaidCardManager.address
  );

  await addActionHandlers({
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
