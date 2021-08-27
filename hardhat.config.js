/**
 * @type import('hardhat/config').HardhatUserConfig
 */

require("@nomiclabs/hardhat-truffle5");
require("solidity-coverage");
require("hardhat-contract-sizer");
require("@openzeppelin/hardhat-upgrades");
require("@nomiclabs/hardhat-ethers");

module.exports = {
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
    ],
  },

  networks: {
    hardhat: {
      initialBaseFeePerGas: 0, // workaround from https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136 . Remove when that issue is closed.
    },

    sokol: {
      url: "https://sokol.poa.network",
      chainId: 77,
      gasPrice: 1000000000,
      derivationPath: "m/44'/60'/0'/0/1",
    },

    xdai: {
      url: "https://rpc.xdaichain.com/",
      chainId: 100,
      derivationPath: "m/44'/60'/0'/0/2",
      gasPrice: 1000000000,
    },
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: true,
  },
  mocha: {
    timeout: 60000,
  },
};
