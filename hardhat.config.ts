/**
 * @type import('hardhat/config').HardhatUserConfig
 */

import "@nomiclabs/hardhat-truffle5";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "@openzeppelin/hardhat-upgrades";
import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "hardhat-watcher";
import "./lib/hardhat-error-on-compiler-warnings";
import "./lib/hardhat-use-local-compiler";

const SOKOL_RPC_URL = "https://sokol.poa.network";
const XDAI_RPC_URL = "https://rpc.xdaichain.com/";

let forking: { url: string },
  forkingChainId: number,
  forkingBlockGasLimit: number;

if (process.env.HARDHAT_FORKING === "sokol") {
  forking = { url: SOKOL_RPC_URL };

  forkingChainId = 77;
  forkingBlockGasLimit = 12500000;
} else if (process.env.HARDHAT_FORKING === "xdai") {
  forkingChainId = 100;
  forking = { url: XDAI_RPC_URL };
  forkingBlockGasLimit = 30000000;
}

let hardhat = {
  initialBaseFeePerGas: 0, // workaround from https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136 . Remove when that issue is closed.
  accounts: {
    // This is here because we need to test at some points for lexigraphical ordering, and in some cases need an account
    // "before" or "after" another address. If you're not getting what you need you can tweak this mnemonic to get a new
    // random set of accounts that are hopefully ordered better. This is only necessary to make tests pass, if they're passing
    // without it ever then it can be removed and use the hardhat default (test test test test test test test test test test test junk)
    mnemonic:
      "fix burden relax exact quick orbit ticket peasant apology outer lady police",
  },
  forking,
};

if (process.env.HARDHAT_FORKING) {
  hardhat["chainId"] = forkingChainId;
  hardhat["blockGasLimit"] = forkingBlockGasLimit;
  hardhat["timeout"] = 5 * 60 * 1000;
}

let config = {
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
          },
          outputSelection: {
            "*": {
              "*": ["storageLayout"],
            },
          },
        },
      },
    ],
  },

  networks: {
    hardhat,
    sokol: {
      url: SOKOL_RPC_URL,
      chainId: 77,
      gasPrice: 20000000000, // 20 gwei
      derivationPath: "m/44'/60'/0'/0/1",
    },

    xdai: {
      url: XDAI_RPC_URL,
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
          params: {
            testFiles: [],
          }, //.e.g ["./test/RewardManger-test.js"]
        },
      ],
      files: ["./test"],
      verbose: true,
    },
  },
};
