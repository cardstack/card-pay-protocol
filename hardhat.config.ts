/**
 * @type import('hardhat/config').HardhatUserConfig
 */

import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-waffle";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-watcher";
import "hardhat-tracer";
import "solidity-coverage";
import "./lib/hardhat-error-on-compiler-warnings";
import "./lib/hardhat-use-local-compiler";

const SOKOL_RPC_URL = "https://sokol.poa.network";
let XDAI_RPC_URL;

if (process.env.HARDHAT_FORKING) {
  // To read old blocks for events for migration test an archive node is needed
  XDAI_RPC_URL = "https://xdai-archive.blockscout.com";
} else {
  XDAI_RPC_URL =
    "https://polished-still-thunder.xdai.quiknode.pro/474f8faa313d36e0dc2604c1373655f7e26fdfb6/";
}

let forking: { url: string; blockNumber?: number },
  forkingChainId: number,
  forkingBlockGasLimit: number;

if (process.env.HARDHAT_FORKING && !process.env.FORK_BLOCK_NUMBER) {
  console.warn(
    "Provide FORK_BLOCK_NUMBER env var when forking otherwise cache will not be used and it will be very very slow!"
  );
}

if (process.env.HARDHAT_FORKING === "sokol") {
  forking = {
    url: SOKOL_RPC_URL,
  };

  forkingChainId = 77;
  forkingBlockGasLimit = 12500000;
} else if (process.env.HARDHAT_FORKING === "xdai") {
  forking = {
    url: XDAI_RPC_URL,
  };
  forkingChainId = 100;
  forkingBlockGasLimit = 30000000;
}

if (process.env.HARDHAT_FORKING && !process.env.FORK_BLOCK_NUMBER) {
  console.warn(
    "Provide FORK_BLOCK_NUMBER env var when forking otherwise cache will not be used and it will be very very slow!"
  );
}

if (process.env.FORK_BLOCK_NUMBER && process.env.FORK_BLOCK_NUMBER) {
  forking["blockNumber"] = parseInt(process.env.FORK_BLOCK_NUMBER);
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
  hardhat["timeout"] = 20 * 60 * 1000;
}

// it's best not to use the optimizer when possible. We can't do anything about this in the case
// of GnosisSafe (they are deployed by Gnosis anyway), but we should refactor PrepaidCardManager to not
// require optimisation to fit below the contract size limit.

const optimizerEnabled = {
  version: "0.8.9",
  settings: {
    optimizer: {
      enabled: true,
    },
  },
};

let config = {
  solidity: {
    compilers: [
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: false,
          },
          outputSelection: {
            "*": {
              "*": ["storageLayout"],
            },
          },
        },
      },
    ],

    overrides: {
      // Prefer refactoring to libraries, splitting contracts etc instead of adding new exceptions here
      "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol": optimizerEnabled,
      "contracts/PrepaidCardManager.sol": optimizerEnabled,
    },
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

export default config;
