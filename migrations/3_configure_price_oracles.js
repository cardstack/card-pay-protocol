const { readJSONSync, existsSync } = require("node-fs-extra");
const ChainlinkOracle = artifacts.require("ChainlinkFeedAdapter");
const DIAOracle = artifacts.require("DIAOracleAdapter");

module.exports = async function (deployer, network) {
  if (["ganache", "test", "soliditycoverage"].includes(network)) {
    return;
  }

  const addressesFile = `./.openzeppelin/addresses-${network}.json`;
  if (!existsSync(addressesFile)) {
    throw new Error(`Cannot read from the addresses file ${addressesFile}`);
  }
  let addresses = readJSONSync(addressesFile);

  let diaOracleAddress;
  let chainlinkDAIUSDAddress;
  let chainlinkETHUSDAddress;

  if (network === "sokol") {
    diaOracleAddress = "0xBA03d4bF8950128a7779C5C1E7899c6E39D29332";
    // use manual feeds in our chainlink oracles
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
  let daiOracle = await ChainlinkOracle.at(daiOracleAddress);
  let cardOracle = await DIAOracle.at(cardOracleAddress);
  console.log(`
==================================================
Configuring DAIOracle ${daiOracleAddress}
  DAI/USD chainlink feed address: ${chainlinkDAIUSDAddress}
  ETH/USD chainlink feed address: ${chainlinkETHUSDAddress}`);
  await daiOracle.setup(
    chainlinkDAIUSDAddress,
    chainlinkETHUSDAddress,
    chainlinkDAIUSDAddress
  );

  console.log(`
==================================================
Configuring CARDOracle ${cardOracleAddress}
  DIA oracle address: ${diaOracleAddress}
  DAI/USD chainlink feed address: ${chainlinkDAIUSDAddress}`);
  await cardOracle.setup(diaOracleAddress, "CARD", chainlinkDAIUSDAddress);
};

function getAddress(contractId, addresses) {
  let info = addresses[contractId];
  if (!info?.proxy) {
    throw new Error(
      `Cannot find proxy address for ${contractId} in addresses file`
    );
  }
  return info.proxy;
}
