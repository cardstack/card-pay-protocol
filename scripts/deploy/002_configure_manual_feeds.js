const retry = require("async-retry");

const hre = require("hardhat");
const {
  makeFactory,
  patchNetworks,
  asyncMain,
  readAddressFile,
} = require("./util");
const { getAddress } = require("./config-utils");
patchNetworks();

const {
  network: { name: network },
} = hre;

async function main(proxyAddresses) {
  // Only setup manual feeds in our test network
  if (["sokol", "hardhat", "localhost"].includes(network)) {
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
    if (
      ["hardhat", "localhost"].includes(network) &&
      !process.env.HARDHAT_FORKING
    ) {
      config = {
        ...config,
        ...{
          CARDUSDFeed: {
            description: "CARD",
            decimals: 8,
            rounds: [
              {
                price: "1186000",
                startedAt: "1618433281",
                updatedAt: "1618433281",
              },
            ],
          },
        },
      };
    }

    proxyAddresses = proxyAddresses || readAddressFile(network);
    let versionManagerAddress = getAddress("VersionManager", proxyAddresses);
    for (let [contractId, feedConfig] of Object.entries(config)) {
      let { contractName, proxy } = proxyAddresses[contractId] ?? {};
      if (!contractName || !proxy) {
        throw new Error(`Cannot find address for ${contractId}`);
      }

      let factory = await makeFactory(contractName);
      await retry(
        async () => {
          let instance = await factory.attach(proxy);
          console.log(`
==================================================
Configuring ${contractId} ${proxy}
  setting description as '${feedConfig.description}'
  setting decimals as '${feedConfig.decimals}'
  setting VersionManager to: ${versionManagerAddress}`);
          await instance.setup(
            feedConfig.description,
            feedConfig.decimals,
            versionManagerAddress
          );
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
            retries: 3,
          }
        );
      }
    }
  }
}

asyncMain(main);
