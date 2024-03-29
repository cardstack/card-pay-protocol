/**
 * @type import('hardhat/config').HardhatUserConfig
 */

import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-truffle5";
import "@nomicfoundation/hardhat-chai-matchers";
import "hardhat-contract-sizer";
import "hardhat-watcher";
import "hardhat-tracer";
import "solidity-coverage";
import "@nomiclabs/hardhat-etherscan";
import "@openzeppelin/hardhat-upgrades";
import "./lib/hardhat-error-on-compiler-warnings";
import "./lib/hardhat-use-local-compiler";

const SOKOL_RPC_URL = "https://sokol-archive.poa.network/";
let XDAI_RPC_URL =
  "https://lively-wandering-flower.xdai.quiknode.pro/3dfea7d446624963a14e4c0032e9af18477ae295/";

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
    // "before" or "after" another address. If tests fail then bumping this number may help
    count: 100,
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

  etherscan: {
    apiKey: {
      xdai: "This just has to be any non-empty string",
      sokol: "This just has to be any non-empty string",
    },
  },
};

export default config;
