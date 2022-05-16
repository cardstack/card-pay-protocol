import {
  getAddress,
  AddressFile,
  ContractConfig,
  GNOSIS_SAFE_MASTER_COPY,
  GNOSIS_SAFE_FACTORY,
  GAS_FEE_RECEIVER,
  GAS_FEE_CARD_WEI,
} from "../../config-utils";

const MINIMUM_AMOUNT = process.env.MINIMUM_AMOUNT ?? "100"; // minimum face value (in SPEND) for new prepaid card
const MAXIMUM_AMOUNT = process.env.MAXIMUM_AMOUNT ?? "10000000"; // maximum face value (in SPEND) for new prepaid card

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }

  return Promise.resolve({
    setup: [
      {
        name: "tokenManager",
        value: address("TokenManager"),
      },
      {
        name: "supplierManager",
        value: address("SupplierManager"),
      },
      {
        name: "exchangeAddress",
        value: address("Exchange"),
      },
      {
        name: "gnosisSafe",
        value: GNOSIS_SAFE_MASTER_COPY,
      },
      {
        name: "gnosisProxyFactory",
        value: GNOSIS_SAFE_FACTORY,
      },
      {
        name: "actionDispatcher",
        value: address("ActionDispatcher"),
      },
      {
        name: "gasFeeReceiver",
        value: GAS_FEE_RECEIVER,
      },
      { name: "gasFeeInCARD", value: GAS_FEE_CARD_WEI },
      { name: "minimumFaceValue", value: MINIMUM_AMOUNT },
      { name: "maximumFaceValue", value: MAXIMUM_AMOUNT },
      { name: "getContractSigners", value: [address("PrepaidCardMarket")] },
      {
        name: "getTrustedCallersForCreatingPrepaidCardsWithIssuer",
        value: [address("PrepaidCardMarketV2")],
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],

    addGasPolicy: {
      transfer: {
        mapping: "gasPoliciesV2",
        value: false,
        params: ["{NAME}", "{VALUE}"],
      },
      split: {
        mapping: "gasPoliciesV2",
        value: true,
        params: ["{NAME}", "{VALUE}"],
      },
      setPrepaidCardInventory: {
        mapping: "gasPoliciesV2",
        value: true,
        params: ["{NAME}", "{VALUE}"],
      },
      removePrepaidCardInventory: {
        mapping: "gasPoliciesV2",
        value: true,
        params: ["{NAME}", "{VALUE}"],
      },
      setPrepaidCardAsk: {
        mapping: "gasPoliciesV2",
        value: true,
        params: ["{NAME}", "{VALUE}"],
      },
      registerRewardProgram: {
        mapping: "gasPoliciesV2",
        value: false,
        params: ["{NAME}", "{VALUE}"],
      },
      registerRewardee: {
        mapping: "gasPoliciesV2",
        value: true,
        params: ["{NAME}", "{VALUE}"],
      },
      lockRewardProgram: {
        mapping: "gasPoliciesV2",
        value: true,
        params: ["{NAME}", "{VALUE}"],
      },
      updateRewardProgramAdmin: {
        mapping: "gasPoliciesV2",
        value: true,
        params: ["{NAME}", "{VALUE}"],
      },
      addRewardRule: {
        mapping: "gasPoliciesV2",
        value: true,
        params: ["{NAME}", "{VALUE}"],
      },
      payRewardTokens: {
        mapping: "gasPoliciesV2",
        value: true,
        params: ["{NAME}", "{VALUE}"],
      },
    },
  });
}
