const RevenuePool = artifacts.require("RevenuePool");
const SPEND = artifacts.require("SPEND");
const L2Token = artifacts.require("ERC677Token");
const GNOSIS_SAFE_MASTER_COPY =
  process.env.GNOSIS_SAFE_MASTER_COPY ??
  `0x6851d6fdfafd08c0295c392436245e5bc78b0185`;
const GNOSIS_SAFE_FACTORY =
  process.env.GNOSIS_SAFE_FACTORY ??
  `0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TALLY = process.env.TALLY ?? ZERO_ADDRESS;

module.exports = async function (deployer, network) {
  if (["ganache", "test", "soliditycoverage"].includes(network)) {
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
