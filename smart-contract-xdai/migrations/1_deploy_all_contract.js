const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const L2Token = artifacts.require("ERC677Token");

const tokenData = {
  "sokol-fork": {
    symbol: "DAICPSK",
    name: "DAICPSK Token",
  },
  sokol: {
    symbol: "DAICPSK",
    name: "DAICPSK Token",
  },
  "xdai-fork": {
    symbol: "DAICPXD",
    name: "DAICPXD Token",
  },
  xdai: {
    symbol: "DAICPXD",
    name: "DAICPXD Token",
  },
  ganache: {
    symbol: "DAICPXD",
    name: "DAICPXD Token",
  },
};

module.exports = async function (deployer, network) {
  let { name, symbol } = tokenData[network] ?? {};
  if (!name || !symbol) {
    throw new Error(
      `There is no Card Protocol configuration for the ${network} network`
    );
  }
  const TOKEN_DETAIL_DATA = [name, symbol, 18];
  await Promise.all([
    // TODO eventually we'll need to map over a list of bridged L2 token addresses
    deployer.deploy(L2Token, ...TOKEN_DETAIL_DATA),
    deployer.deploy(PrepaidCardManager),
    deployer.deploy(RevenuePool),
  ]);
  let l2Token = await L2Token.deployed();
  let prepaidCardManager = await PrepaidCardManager.deployed();
  let revenuePool = await RevenuePool.deployed();

  console.log(`Deployed ${name} contract to ${l2Token.address}`);
  console.log(
    `Deployed PrepaidCardManager contract to ${prepaidCardManager.address}`
  );
  console.log(`Deployed RevenuePool contract to ${revenuePool.address}`);
  console.log();
};
