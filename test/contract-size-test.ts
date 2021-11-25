import hre from "hardhat";

const { artifacts } = hre;

const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const PrepaidCardMarket = artifacts.require("PrepaidCardMarket");
const RevenuePool = artifacts.require("RevenuePool");
const BridgeUtils = artifacts.require("BridgeUtils");
const SPEND = artifacts.require("SPEND");
const Feed = artifacts.require("ManualFeed");
const ChainlinkOracle = artifacts.require("ChainlinkFeedAdapter");
const DIAOracle = artifacts.require("DIAOracleAdapter");
const RewardPool = artifacts.require("RewardPool");
const Exchange = artifacts.require("Exchange");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const PayMerchantHandler = artifacts.require("PayMerchantHandler");
const RegisterMerchantHandler = artifacts.require("RegisterMerchantHandler");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");
const MerchantManager = artifacts.require("MerchantManager");
const SplitPrepaidCardHandler = artifacts.require("SplitPrepaidCardHandler");
const TransferPrepaidCardHandler = artifacts.require(
  "TransferPrepaidCardHandler"
);
const SetPrepaidCardInventoryHandler = artifacts.require(
  "SetPrepaidCardInventoryHandler"
);
const RemovePrepaidCardInventoryHandler = artifacts.require(
  "RemovePrepaidCardInventoryHandler"
);
const SetPrepaidCardAskHandler = artifacts.require("SetPrepaidCardAskHandler");
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
const VersionManager = artifacts.require("VersionManager");

describe("Contract deploy gas usage", async () => {
  it("Deploys all of the contracts", async () => {
    await Promise.all([
      // We use this to measure gas for all our contract creation. Please add
      // any new contracts here:
      await PrepaidCardManager.new(),
      await PrepaidCardMarket.new(),
      await RevenuePool.new(),
      await BridgeUtils.new(),
      await SPEND.new(),
      await Feed.new(),
      await ChainlinkOracle.new(),
      await DIAOracle.new(),
      await RewardPool.new(),
      await Exchange.new(),
      await ActionDispatcher.new(),
      await PayMerchantHandler.new(),
      await RegisterMerchantHandler.new(),
      await TokenManager.new(),
      await SupplierManager.new(),
      await MerchantManager.new(),
      await SplitPrepaidCardHandler.new(),
      await TransferPrepaidCardHandler.new(),
      await SetPrepaidCardInventoryHandler.new(),
      await RemovePrepaidCardInventoryHandler.new(),
      await SetPrepaidCardAskHandler.new(),
      await RewardManager.new(),
      await RegisterRewardProgramHandler.new(),
      await RegisterRewardeeHandler.new(),
      await LockRewardProgramHandler.new(),
      await UpdateRewardProgramAdminHandler.new(),
      await AddRewardRuleHandler.new(),
      await VersionManager.new(),
    ]);
  });
});
