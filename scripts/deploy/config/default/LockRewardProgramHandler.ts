import { getAddress, AddressFile, ContractConfig } from "../../config-utils";

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  return Promise.resolve({
    setup: [
      {
        name: "actionDispatcher",
        value: address("ActionDispatcher"),
      },
      {
        name: "prepaidCardManager",
        value: address("PrepaidCardManager"),
      },
      {
        name: "exchangeAddress",
        value: address("Exchange"),
      },
      {
        name: "tokenManagerAddress",
        value: address("TokenManager"),
      },
      {
        name: "rewardManagerAddress",
        value: address("RewardManager"),
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
