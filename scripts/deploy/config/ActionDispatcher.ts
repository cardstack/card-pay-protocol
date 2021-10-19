import { getAddress, AddressFile, ContractConfig } from "../config-utils";

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
        name: "exchangeAddress",
        value: address("Exchange"),
      },
      {
        name: "prepaidCardManager",
        value: address("PrepaidCardManager"),
      },
    ],

    addHandler: {
      payMerchant: {
        mapping: "actions",
        value: address("PayMerchantHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      registerMerchant: {
        mapping: "actions",
        value: address("RegisterMerchantHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      split: {
        mapping: "actions",
        value: address("SplitPrepaidCardHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      setPrepaidCardInventory: {
        mapping: "actions",
        value: address("SetPrepaidCardInventoryHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      removePrepaidCardInventory: {
        mapping: "actions",
        value: address("RemovePrepaidCardInventoryHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      setPrepaidCardAsk: {
        mapping: "actions",
        value: address("SetPrepaidCardAskHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      transfer: {
        mapping: "actions",
        value: address("TransferPrepaidCardHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      registerRewardee: {
        mapping: "actions",
        value: address("RegisterRewardeeHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      registerRewardProgram: {
        mapping: "actions",
        value: address("RegisterRewardProgramHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      lockRewardProgram: {
        mapping: "actions",
        value: address("LockRewardProgramHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      addRewardRule: {
        mapping: "actions",
        value: address("AddRewardRuleHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      removeRewardRule: {
        mapping: "actions",
        value: address("RemoveRewardRuleHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      updateRewardProgramAdmin: {
        mapping: "actions",
        value: address("UpdateRewardProgramAdminHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
      payRewardTokens: {
        mapping: "actions",
        value: address("PayRewardTokensHandler"),
        params: ["{VALUE}", "{NAME}"],
      },
    },
  });
}
