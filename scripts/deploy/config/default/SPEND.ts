import { getAddress, AddressFile, ContractConfig } from "../../config-utils";

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  const minter = address("PayMerchantHandler");
  return Promise.resolve({
    setup: [
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
    addMinter: {
      [minter]: {
        mapping: "getMinters",
        getterParams: [],
        value: minter,
        params: ["{VALUE}"],
      },
    },
  });
}
