import {
  getAddress,
  AddressFile,
  ContractConfig,
  PREPAID_CARD_PROVISIONERS,
} from "../../config-utils";

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  return Promise.resolve({
    setup: [
      {
        name: "prepaidCardManagerAddress",
        value: address("PrepaidCardManager"),
      },
      {
        name: "tokenManager",
        value: address("TokenManager"),
      },
      {
        name: "actionDispatcher",
        value: address("ActionDispatcher"),
      },
      {
        name: "getProvisioners",
        value: PREPAID_CARD_PROVISIONERS,
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
