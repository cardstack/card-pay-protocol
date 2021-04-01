const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const L2Token = artifacts.require("ERC677Token");

// minimum face value (in SPEND) for new prepaid card
const MINIMUM_AMOUNT = process.env.MINIMUM_AMOUNT ?? 100;
// maximum face value (in SPEND) for new prepaid card
const MAXIMUM_AMOUNT = process.env.MAXIMUM_AMOUNT ?? 100000 * 100;
const GNOSIS_SAFE_MASTER_COPY =
  process.env.GNOSIS_SAFE_MASTER_COPY ??
  `0x6851d6fdfafd08c0295c392436245e5bc78b0185`;
const GNOSIS_SAFE_FACTORY =
  process.env.GNOSIS_SAFE_FACTORY ??
  `0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TALLY = process.env.TALLY ?? ZERO_ADDRESS;

module.exports = async function (_, network) {
  if (network === "ganache") {
    return;
  }

  let prepaidCardManager = await PrepaidCardManager.deployed();
  let pool = await RevenuePool.deployed();
  let l2Token = await L2Token.deployed();
  let acceptedL2Tokens = [l2Token.address];

  await prepaidCardManager.setup(
    TALLY,
    GNOSIS_SAFE_MASTER_COPY,
    GNOSIS_SAFE_FACTORY,
    pool.address,
    acceptedL2Tokens,
    MINIMUM_AMOUNT,
    MAXIMUM_AMOUNT
  );
  console.log(`configured prepaid card manager:
  Tally contract address:              ${TALLY}
  Gnosis safe master copy:             ${GNOSIS_SAFE_MASTER_COPY}
  Gnosis safe factory:                 ${GNOSIS_SAFE_FACTORY}
  Revenue pool address:                ${pool.address}
  Prepaid card Accepted L2 tokens:     ${acceptedL2Tokens.join(", ")}
  Minimum new prepaid card face value: ${MINIMUM_AMOUNT} SPEND
  Maximum new prepaid card face value: ${MAXIMUM_AMOUNT} SPEND
`);
};
