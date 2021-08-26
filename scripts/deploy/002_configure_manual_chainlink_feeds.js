const { readJSONSync, existsSync } = require("node-fs-extra");
const retry = require("async-retry");

const hre = require("hardhat");
const { makeFactory, patchNetworks, asyncMain } = require("./util");
patchNetworks();

async function main() {
  const {
    network: { name: network }
  } = hre;
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
            updatedAt: "1618433281"
          }
        ]
      },
      ETHUSDFeed: {
        description: "ETH",
        decimals: 8,
        rounds: [
          {
            price: "330999661517",
            startedAt: "1618433281",
            updatedAt: "1618433281"
          }
        ]
      }
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

      let factory = await makeFactory(contractName);
      await retry(
        async () => {
          let instance = await factory.attach(proxy);
          console.log(`
          ==================================================
          Configuring ${contractId} ${proxy}
            setting description as '${feedConfig.description}'
            setting decimals as '${feedConfig.decimals}'`);
          await instance.setup(feedConfig.description, feedConfig.decimals);
        },
        { retries: 5 }
      );
      for (let { price, startedAt, updatedAt } of feedConfig.rounds) {
        await retry(
          async () => {
            console.log(
              `  adding round: price ${price}, startedAt(unix) ${startedAt}, updatedAt(unix) ${updatedAt}`
            );

            let instance = await factory.attach(proxy);
            await instance.addRound(price, startedAt, updatedAt);
          },
          {
            retries: 3
          }
        );
      }
    }
  }
}

asyncMain(main);
