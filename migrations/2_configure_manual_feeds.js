const { readJSONSync, existsSync } = require("node-fs-extra");

module.exports = async function (deployer, network) {
  if (["ganache", "test", "soliditycoverage"].includes(network)) {
    return;
  }

  // Feed config
  let config = {
    CARDFeed: {
      description: "CARD/USD",
      decimals: 8,
      rounds: [
        {
          price: "907143",
          startedAt: "1618433281",
          updatedAt: "1618433281",
        },
      ],
    },
    DAIFeed: {
      description: "DAI/USD",
      decimals: 8,
      rounds: [
        {
          price: "100085090",
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
  for (let contractId of ["CARDFeed", "DAIFeed"]) {
    let { contractName, proxy } = proxyAddresses[contractId] ?? {};
    if (!contractName || !proxy) {
      throw new Error(
        `Cannot find entry ${contractId} in the addresses file ${addressesFile}`
      );
    }
    let factory = artifacts.require(contractName);
    let instance = await factory.at(proxy);
    let feedConfig = config[contractId];
    if (!feedConfig) {
      throw new Error(`No feed config for ${contractId}`);
    }
    console.log(`
==================================================`);
    console.log(`Configuring ${contractId} ${proxy}`);
    console.log(`  setting description as '${feedConfig.description}'`);
    console.log(`  setting decimals as '${feedConfig.decimals}'`);
    await instance.setup(feedConfig.description, feedConfig.decimals);
    for (let { price, startedAt, updatedAt } of feedConfig.rounds) {
      console.log(
        `  adding round: price ${price}, startedAt(unix) ${startedAt}, updatedAt(unix) ${updatedAt}`
      );
      await instance.addRound(price, startedAt, updatedAt);
    }
  }
};
