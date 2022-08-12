// Contract init details. For each upgradable contract provide a property
// name that represents the contract "ID" (this is useful when there are
// multiple instances of the same contract that need to be deployed), where
// the value is an object that specifies the contract's name (as specified
// in the solidity file), and an array of the initialize parameters to use
// when creating the upgradable contract.

import { ZERO_ADDRESS } from "./config-utils";

type ContractInitSpec = {
  [contractId: string]: {
    contractName: string;
    init: string[];
    nonUpgradeable?: boolean;
  };
};

export default function ({
  network,
  owner = ZERO_ADDRESS,
  onlyUpgradeable = false,
}: {
  network: string;
  owner?: string;
  onlyUpgradeable?: boolean;
}): ContractInitSpec {
  let contracts = {
    VersionManager: {
      contractName: "VersionManager",
      init: [owner],
    },
    PrepaidCardManager: {
      contractName: "PrepaidCardManager",
      init: [owner],
    },
    PrepaidCardMarket: {
      contractName: "PrepaidCardMarket",
      init: [owner],
    },
    PrepaidCardMarketV2: {
      contractName: "PrepaidCardMarketV2",
      init: [owner],
    },
    RevenuePool: { contractName: "RevenuePool", init: [owner] },
    RewardPool: { contractName: "RewardPool", init: [owner] },
    Exchange: { contractName: "Exchange", init: [owner] },
    ActionDispatcher: {
      contractName: "ActionDispatcher",
      init: [owner],
    },
    PayMerchantHandler: {
      contractName: "PayMerchantHandler",
      init: [owner],
    },
    RegisterMerchantHandler: {
      contractName: "RegisterMerchantHandler",
      init: [owner],
    },
    SplitPrepaidCardHandler: {
      contractName: "SplitPrepaidCardHandler",
      init: [owner],
    },
    TransferPrepaidCardHandler: {
      contractName: "TransferPrepaidCardHandler",
      init: [owner],
    },
    SetPrepaidCardInventoryHandler: {
      contractName: "SetPrepaidCardInventoryHandler",
      init: [owner],
    },
    RemovePrepaidCardInventoryHandler: {
      contractName: "RemovePrepaidCardInventoryHandler",
      init: [owner],
    },
    SetPrepaidCardAskHandler: {
      contractName: "SetPrepaidCardAskHandler",
      init: [owner],
    },
    AddPrepaidCardSKUHandler: {
      contractName: "AddPrepaidCardSKUHandler",
      init: [owner],
    },
    BridgeUtils: { contractName: "BridgeUtils", init: [owner] },
    TokenManager: { contractName: "TokenManager", init: [owner] },
    MerchantManager: {
      contractName: "MerchantManager",
      init: [owner],
    },
    SupplierManager: {
      contractName: "SupplierManager",
      init: [owner],
    },
    SPEND: { contractName: "SPEND", init: [owner] },
    DAIOracle: { contractName: "ChainlinkFeedAdapter", init: [owner] },
    CARDOracle: { contractName: "DIAOracleAdapter", init: [owner] },
    RewardManager: { contractName: "RewardManager", init: [owner] },
    AddRewardRuleHandler: {
      contractName: "AddRewardRuleHandler",
      init: [owner],
    },
    LockRewardProgramHandler: {
      contractName: "LockRewardProgramHandler",
      init: [owner],
    },
    RegisterRewardProgramHandler: {
      contractName: "RegisterRewardProgramHandler",
      init: [owner],
    },
    RegisterRewardeeHandler: {
      contractName: "RegisterRewardeeHandler",
      init: [owner],
    },
    UpdateRewardProgramAdminHandler: {
      contractName: "UpdateRewardProgramAdminHandler",
      init: [owner],
    },
    PayRewardTokensHandler: {
      contractName: "PayRewardTokensHandler",
      init: [owner],
    },
  };

  if (!onlyUpgradeable) {
    contracts["RewardSafeDelegateImplementation"] = {
      contractName: "RewardSafeDelegateImplementation",
      init: [],
      nonUpgradeable: true,
    };
  }
  // Use manual feeds in sokol
  if (["sokol", "hardhat", "localhost"].includes(network)) {
    contracts["DAIUSDFeed"] = {
      contractName: "ManualFeed",
      init: [owner],
    };
    contracts["ETHUSDFeed"] = {
      contractName: "ManualFeed",
      init: [owner],
    };
  }
  // only use mock DIA for private networks
  if (
    ["hardhat", "localhost"].includes(network) &&
    !process.env.HARDHAT_FORKING
  ) {
    contracts["CARDOracle"] = {
      contractName: "ChainlinkFeedAdapter",
      init: [owner],
    };
    contracts["CARDUSDFeed"] = {
      contractName: "ManualFeed",
      init: [owner],
    };
  }

  // this mechanism is put in place to ensure that typos in the above contracts data structure do not lead to unintentionally deploying the wrong contract
  const nameExceptions = [
    "DAIOracle",
    "CARDOracle",
    "DAIUSDFeed",
    "ETHUSDFeed",
    "CARDUSDFeed",
  ];

  for (let contractId of Object.keys(contracts)) {
    let contractName = contracts[contractId].contractName;
    if (contractName !== contractId && !nameExceptions.includes(contractId)) {
      throw new Error(
        `${contractId} has contract name ${contractName} - is that intentional? If so, add it to the exception list in scripts/deploy/config/contract-init-spec.ts`
      );
    }
  }

  return contracts;
}
