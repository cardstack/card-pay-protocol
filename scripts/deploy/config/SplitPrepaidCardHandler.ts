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
        name: "actionDispatcher",
        value: address("ActionDispatcher"),
      },
      {
        name: "prepaidCardManagerAddress",
        value: address("PrepaidCardManager"),
      },
      {
        name: "tokenManagerAddress",
        value: address("TokenManager"),
      },
      {
        name: "defaultMarketAddress",
        value: address("PrepaidCardMarket"),
      },
    ],
  });
}
