/**
 * @type import('hardhat/config').HardhatUserConfig
 */

import "@nomiclabs/hardhat-truffle5";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "@openzeppelin/hardhat-upgrades";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "@nomiclabs/hardhat-ethers";
import "hardhat-watcher";

import glob from "fast-glob";

// force compiler version 0.5.17 for gnosis safe contracts, because their pragma
// version is too lenient and they won't actually compile with 0.6.8 compiler
const overrides = glob
  .sync(`${__dirname}/node_modules/@gnosis.pm/safe-contracts/**/*.sol`)
  .reduce(
    (memo, path) =>
      Object.assign(memo, {
        [path.split("node_modules/")[1]]: { version: "0.5.17" },
      }),
    {}
  );

export default {
  solidity: {
    compilers: [
      {
        version: "0.5.17",
        settings: {
          evmVersion: "istanbul",
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.6.8",
        settings: {
          optimizer: {
            enabled: true,
          },
        },
      },
      {
        version: "0.8.0",
        settings: {
          optimizer: {
            enabled: true,
          },
        },
      },
    ],
    overrides,
  },

  networks: {
    hardhat: {
      initialBaseFeePerGas: 0, // workaround from https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136 . Remove when that issue is closed.
    },

    sokol: {
      url: "https://sokol.poa.network",
      chainId: 77,
      gasPrice: 20000000000, // 20 gwei
      derivationPath: "m/44'/60'/0'/0/1",
    },

    xdai: {
      url: "https://rpc.xdaichain.com/",
      chainId: 100,
      derivationPath: "m/44'/60'/0'/0/2",
      gasPrice: 20000000000, // 20 gwei
    },
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: true,
  },
  mocha: {
    timeout: 60000,
  },
  watcher: {
    compile: {
      tasks: ["compile"],
      files: ["./contracts"],
      verbose: true,
    },
    test: {
      tasks: [
        {
          command: "test",
          params: { testFiles: [] }, //.e.g ["./test/RewardManger-test.js"]
        },
      ],
      files: ["./test"],
      verbose: true,
    },
  },
};
