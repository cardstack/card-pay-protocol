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
        name: "merchantManager",
        value: address("MerchantManager"),
      },
      {
        name: "prepaidCardManager",
        value: address("PrepaidCardManager"),
      },
      {
        name: "revenuePoolAddress",
        value: address("RevenuePool"),
      },
      {
        name: "spendTokenAddress",
        value: address("SPEND"),
      },
      {
        name: "tokenManagerAddress",
        value: address("TokenManager"),
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
