const { readAddressFile } = require("./util");
const retry = require("async-retry");

const hre = require("hardhat");
const { makeFactory, patchNetworks, asyncMain } = require("./util");
patchNetworks();
const {
  network: { name: network },
} = hre;

async function main(addresses) {
  const ChainlinkOracle = await makeFactory("ChainlinkFeedAdapter");
  const DIAOracle = await makeFactory("DIAOracleAdapter");

  addresses = addresses || readAddressFile(network);

  let diaOracleAddress;
  let chainlinkCARDUSDAddress; // testing only
  let chainlinkDAIUSDAddress;
  let chainlinkETHUSDAddress;
  let versionManagerAddress = getAddress("VersionManager", addresses);

  if (network === "sokol") {
    diaOracleAddress = "0xBA03d4bF8950128a7779C5C1E7899c6E39D29332";
    // use manual feeds in our chainlink oracles
    chainlinkDAIUSDAddress = getAddress("DAIUSDFeed", addresses);
    chainlinkETHUSDAddress = getAddress("ETHUSDFeed", addresses);
  } else if (["hardhat", "localhost"].includes(network)) {
    chainlinkCARDUSDAddress = getAddress("CARDUSDFeed", addresses);
    chainlinkDAIUSDAddress = getAddress("DAIUSDFeed", addresses);
    chainlinkETHUSDAddress = getAddress("ETHUSDFeed", addresses);
  } else if (network === "xdai") {
    // These are the addresses our partners provided to us for xdai
    diaOracleAddress = "0xA36514cD18FFCdeC749c248B260d80be4dcDBBF1";
    chainlinkDAIUSDAddress = "0x678df3415fc31947dA4324eC63212874be5a82f8";
    chainlinkETHUSDAddress = "0xa767f745331D267c7751297D982b050c93985627";
  } else {
    throw new Error(
      `Don't know how to configure oracles for network ${network}`
    );
  }

  let daiOracleAddress = getAddress("DAIOracle", addresses);
  let cardOracleAddress = getAddress("CARDOracle", addresses);
  let daiOracle = await ChainlinkOracle.attach(daiOracleAddress);
  await retry(
    async () => {
      console.log(`
==================================================
Configuring DAIOracle ${daiOracleAddress}
  DAI/USD chainlink feed address: ${chainlinkDAIUSDAddress}
  ETH/USD chainlink feed address: ${chainlinkETHUSDAddress}
  VersionManager address: ${versionManagerAddress}`);

      await daiOracle.setup(
        chainlinkDAIUSDAddress,
        chainlinkETHUSDAddress,
        chainlinkDAIUSDAddress,
        versionManagerAddress
      );
    },
    { retries: 3 }
  );

  if (!chainlinkCARDUSDAddress) {
    // use real DIA Oracle
    let cardOracle = await DIAOracle.attach(cardOracleAddress);
    await retry(
      async () => {
        console.log(`
==================================================
Configuring CARDOracle ${cardOracleAddress}
  DIA oracle address: ${diaOracleAddress}
  DAI/USD chainlink feed address: ${chainlinkDAIUSDAddress}
  VersionManager address: ${versionManagerAddress}`);
        await cardOracle.setup(
          diaOracleAddress,
          "CARD",
          chainlinkDAIUSDAddress,
          versionManagerAddress
        );
      },
      { retries: 3 }
    );
  } else {
    // Use manual feed DIA Oracle (for hardhat deploys only)
    let cardManualOracle = await ChainlinkOracle.attach(cardOracleAddress);
    await retry(
      async () => {
        console.log(`
==================================================
Configuring CARDOracle (for manual feed) ${cardOracleAddress}
  CARD/USD chainlink feed address: ${chainlinkCARDUSDAddress}
  ETH/USD chainlink feed address: ${chainlinkETHUSDAddress}
  DAI/USD chainlink feed address: ${chainlinkDAIUSDAddress}
  VersionManager address: ${versionManagerAddress}
  `);

        await cardManualOracle.setup(
          chainlinkCARDUSDAddress,
          chainlinkETHUSDAddress,
          chainlinkDAIUSDAddress,
          versionManagerAddress
        );
      },
      { retries: 3 }
    );
  }
}

function getAddress(contractId, addresses) {
  let info = addresses[contractId];
  if (!info?.proxy) {
    throw new Error(
      `Cannot find proxy address for ${contractId} in addresses file`
    );
  }
  return info.proxy;
}

asyncMain(main);
