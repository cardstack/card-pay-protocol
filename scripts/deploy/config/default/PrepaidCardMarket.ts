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
        name: "actionDispatcher",
        value: address("ActionDispatcher"),
      },
      {
        name: "provisioner",
        value: PREPAID_CARD_PROVISIONERS[0],
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
