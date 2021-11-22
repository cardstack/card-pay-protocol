import {
  getAddress,
  AddressFile,
  ContractConfig,
  DAI_USD_RATE_SNAP_THRESHOLD,
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
        name: "tokenUsdFeed",
        value: address("DAIUSDFeed"),
      },
      {
        name: "ethUsdFeed",
        value: address("ETHUSDFeed"),
      },
      {
        name: "daiUsdFeed",
        value: address("DAIUSDFeed"),
      },
      {
        name: "canSnapToUSD",
        value: true,
      },
      {
        name: "snapThreshold",
        value: DAI_USD_RATE_SNAP_THRESHOLD,
        formatter: (v) => `${(Number(v) / 100000000).toFixed(4)}%`,
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
