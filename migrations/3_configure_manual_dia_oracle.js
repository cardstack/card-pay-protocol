const { readJSONSync, existsSync } = require("node-fs-extra");

module.exports = async function (deployer, network) {
  // Only setup manual feeds in our test network
  if (network === "sokol") {
    let config = {
      MockDIA: {
        values: [
          {
            pair: "CARD/USD",
            price: "1425979",
            updatedAt: "1620200386",
          },
          {
            pair: "CARD/ETH",
            price: "434",
            updatedAt: "1620200506",
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
Configuring ${contractId} ${proxy}`);
      for (let { pair, price, updatedAt } of feedConfig.values) {
        console.log(
          `  adding value: pair: ${pair}, price ${price}, updatedAt(unix) ${updatedAt}`
        );
        await instance.setValue(pair, price, updatedAt);
      }
    }
  }
};
