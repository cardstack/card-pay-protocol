import {
  asyncMain,
  contractInitSpec,
  getNetwork,
  getUpgradeManager,
} from "./util";

// This utility is used to generate the addresses of the locally
// deployed card pay protocol contracts in a format suitable for
// deploying the subgraph locally and should be used with the following command:
// `npx hardhat run scripts/deploy/print-contract-addresses-for-subgraph.ts`

// The output of this utility is then copied to cardpay-subgraph/localchain-addresses.json,
// followed by `yarn codegen-localchain`, which generates the subgraph schema, which is then
// used to deploy the subgraph to the locally running graph node.

// The zero addresses are contracts that are deployed outside this protocol.
// Add them as needed if you need to run the subgraph mappings for them. For running
// a local graph node and testing mappings from contracts in this repo, these
// addresses should not be needed and can stay zero addresses.
let contractsForSubgraph = {
  gnosisProxyFactory_v1_2: "0x0000000000000000000000000000000000000000",
  gnosisProxyFactory_v1_3: "0x0000000000000000000000000000000000000000",
  homeBridge: "0x0000000000000000000000000000000000000000",
  homeAMB: "0x0000000000000000000000000000000000000000",
  daiCpxd: "0x0000000000000000000000000000000000000000",
  cardCpxd: "0x0000000000000000000000000000000000000000",
  spend: "0x0000000000000000000000000000000000000000",
  deprecatedMerchantManager_v0_6_7:
    "0x0000000000000000000000000000000000000000",
  uniswapV2Factory: "0x0000000000000000000000000000000000000000",
  prepaidCardManager: null,
  prepaidCardMarket: null,
  prepaidCardMarketV2: null,
  revenuePool: null,
  bridgeUtils: null,
  exchange: null,
  payMerchantHandler: null,
  registerMerchantHandler: null,
  splitPrepaidCardHandler: null,
  transferPrepaidCardHandler: null,
  supplierManager: null,
  merchantManager: null,
  actionDispatcher: null,
  rewardPool: null,
  rewardManager: null,
  registerRewardProgramHandler: null,
  registerRewardeeHandler: null,
  versionManager: null,
};

let network = getNetwork();

async function main() {
  let upgradeManager = await getUpgradeManager(network);
  let contracts = contractInitSpec({ network });

  for (let [contractId] of Object.entries(contracts)) {
    let proxyAddress = await upgradeManager.adoptedContractAddresses(
      contractId
    );

    let contractNameUncapitalized =
      contractId.charAt(0).toLowerCase() + contractId.slice(1);

    if (contractsForSubgraph[contractNameUncapitalized] === null) {
      contractsForSubgraph[contractNameUncapitalized] = proxyAddress;
    }
  }

  console.log(JSON.stringify(contractsForSubgraph));
  console.log(
    "\n Copy the above JSON to cardpay-subgraph/localchain-addresses.json!"
  );
}

asyncMain(main);
