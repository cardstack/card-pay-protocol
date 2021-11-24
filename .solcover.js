module.exports = {
  skipFiles: [
    // This contract is a mock malicious contract and the tests make sure the code is _not_ run
    "dev/FakeRewardManager.sol",
  ],
  providerOptions: {
    total_accounts: 1000,
  },
};
