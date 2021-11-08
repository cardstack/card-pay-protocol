import { getAddress, AddressFile, ContractConfig } from "../../config-utils";
import {
  chainlinkDAIUSDAddress,
  chainlinkETHUSDAddress,
} from "../../xdai-oracles";

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  return Promise.resolve({
    setup: [
      {
        name: "tokenUsdFeed",
        value: chainlinkDAIUSDAddress,
      },
      {
        name: "ethUsdFeed",
        value: chainlinkETHUSDAddress,
      },
      {
        name: "daiUsdFeed",
        value: chainlinkDAIUSDAddress,
      },
      {
        name: "canSnapToUSD",
        value: true,
      },
      {
        name: "snapThreshold",
        value: 1000000,
        formatter: (v) => `${(Number(v) / 100000000).toFixed(4)}%`,
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
