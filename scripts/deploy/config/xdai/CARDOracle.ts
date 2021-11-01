import { getAddress, AddressFile, ContractConfig } from "../../config-utils";
import { diaOracleAddress, chainlinkDAIUSDAddress } from "../../xdai-oracles";

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  return Promise.resolve({
    setup: [
      {
        name: "oracle",
        value: diaOracleAddress,
      },
      {
        name: "tokenSymbol",
        value: "CARD",
      },
      {
        name: "daiUsdFeed",
        value: chainlinkDAIUSDAddress,
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
