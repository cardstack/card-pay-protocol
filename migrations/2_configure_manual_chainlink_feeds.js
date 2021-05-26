const { readJSONSync, existsSync } = require("node-fs-extra");
const { sendTxnWithRetry: sendTx } = require("../lib/utils");

module.exports = async function (_deployer, network) {
  // Only setup manual feeds in our test network
  if (network === "sokol") {
    let config = {
      DAIUSDFeed: {
        description: "DAI",
        decimals: 8,
        rounds: [
          {
            price: "100200000",
            startedAt: "1618433281",
            updatedAt: "1618433281",
          },
        ],
      },
      ETHUSDFeed: {
        description: "ETH",
        decimals: 8,
        rounds: [
          {
            price: "330999661517",
            startedAt: "1618433281",
            updatedAt: "1618433281",
          },
        ],
      },
    };

    const addressesFile = `./.openzeppelin/addresses-${network}.json`;
    if (!existsSync(addressesFile)) {
      throw new Error(`Cannot read from the addresses file ${addressesFile}`);
    }
    let proxyAddresses = readJSONSync(addressesFile);
    for (let [contractId, feedConfig] of Object.entries(config)) {
      let { contractName, proxy } = proxyAddresses[contractId] ?? {};
      if (!contractName || !proxy) {
        throw new Error(
          `Cannot find entry ${contractId} in the addresses file ${addressesFile}`
        );
      }
      let factory = artifacts.require(contractName);
      let instance = await factory.at(proxy);
      console.log(`
==================================================
Configuring ${contractId} ${proxy}
  setting description as '${feedConfig.description}'
  setting decimals as '${feedConfig.decimals}'`);
      await sendTx(() =>
        instance.setup(feedConfig.description, feedConfig.decimals)
      );
      for (let { price, startedAt, updatedAt } of feedConfig.rounds) {
        console.log(
          `  adding round: price ${price}, startedAt(unix) ${startedAt}, updatedAt(unix) ${updatedAt}`
        );
        await sendTx(() => instance.addRound(price, startedAt, updatedAt));
      }
    }
  }
};
