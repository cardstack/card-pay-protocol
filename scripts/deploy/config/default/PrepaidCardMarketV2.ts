import {
  getAddress,
  AddressFile,
  ContractConfig,
  PREPAID_CARD_PROVISIONER,
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
        name: "provisioner",
        value: PREPAID_CARD_PROVISIONER,
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
        name: "getTrustedProvisioners",
        value: [PREPAID_CARD_PROVISIONER],
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
