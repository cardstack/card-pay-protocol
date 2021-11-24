module.exports = {
  skipFiles: [
    // This contract is only used to pull in npm solidity artifacts used for
    // testing
    "contracts/dev/DevDependencies.sol",
    // This contract is a mock malicious contract and the tests make sure the code is _not_ run
    "contracts/dev/FakeRewardManager.sol",
    "contracts/deprecated/*.sol",
  ],
  providerOptions: {
    total_accounts: 1000,
  },
};
