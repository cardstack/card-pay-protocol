module.exports = {
  skipFiles: [
    // This contract is a mock malicious contract and the tests make sure the code is _not_ run
    "dev/FakeRewardManager.sol",

    // solidity-parser cannot parse this file due to inline assembly
    // https://github.com/protofire/solhint/issues/328
    "core/ReentrancyGuard.sol",

    // Migration contracts not run in coverage tests
    "migration/EnumerableSetUpgradeUtil.sol",
    "migration/MerchantManagerUpgrader.sol",
    "migration/PrepaidCardManagerUpgrader.sol",
    "migration/PrepaidCardMarketUpgrader.sol",
    "migration/RevenuePoolUpgrader.sol",
    "migration/RewardManagerUpgrader.sol",
    "migration/RewardPoolUpgrader.sol",
    "migration/SPENDUpgrader.sol",
    "migration/TokenManagerUpgrader.sol",
  ],
  providerOptions: {
    total_accounts: 1000,
  },
};
