const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

module.exports = {
  TALLY: process.env.TALLY ?? ZERO_ADDRESS,
  GNOSIS_SAFE_MASTER_COPY:
    process.env.GNOSIS_SAFE_MASTER_COPY ??
    `0x6851d6fdfafd08c0295c392436245e5bc78b0185`,
  GNOSIS_SAFE_FACTORY:
    process.env.GNOSIS_SAFE_FACTORY ??
    `0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B`,
  MINIMUM_AMOUNT: process.env.MINIMUM_AMOUNT ?? 100, //minimum face value (in SPEND) for new prepaid card
  MAXIMUM_AMOUNT: process.env.MAXIMUM_AMOUNT ?? 100000 * 100, //maximum face value (in SPEND) for new prepaid card
};
