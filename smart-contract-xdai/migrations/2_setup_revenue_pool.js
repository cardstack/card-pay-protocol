const RevenuePool = artifacts.require("RevenuePool");
const SPEND = artifacts.require("SPEND");
const L2Token = artifacts.require("ERC677Token");
const {
  TALLY,
  GNOSIS_SAFE_FACTORY,
  GNOSIS_SAFE_MASTER_COPY,
} = require("./constants");

module.exports = async function (deployer, network) {
  if (network === "ganache") {
    return;
  }

  let pool = await RevenuePool.deployed();
  let l2Token = await L2Token.deployed();

  await deployer.deploy(SPEND, "SPEND Token", "SPEND", [pool.address]);
  console.log(`Deployed SPEND contract to ${SPEND.address}`);

  let spend = await SPEND.deployed();
  let acceptedL2Tokens = [l2Token.address];

  await pool.setup(
    TALLY,
    GNOSIS_SAFE_MASTER_COPY,
    GNOSIS_SAFE_FACTORY,
    spend.address,
    acceptedL2Tokens
  );

  console.log(`configured revenue pool:
  Tally contract address:          ${TALLY}
  Gnosis safe master copy:         ${GNOSIS_SAFE_MASTER_COPY}
  Gnosis safe factory:             ${GNOSIS_SAFE_FACTORY}
  SPEND token address:             ${spend.address}
  Revenue Pool accepted L2 tokens: ${acceptedL2Tokens.join(", ")}
`);
};
