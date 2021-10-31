import {
  getAddress,
  AddressFile,
  ContractConfig,
  PAYABLE_TOKENS,
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
        name: "bridgeUtils",
        value: address("BridgeUtils"),
      },
      {
        name: "getTokens",
        value: PAYABLE_TOKENS,
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
