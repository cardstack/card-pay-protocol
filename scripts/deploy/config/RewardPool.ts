import {
  getAddress,
  AddressFile,
  ContractConfig,
  TALLY,
} from "../config-utils";

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  return Promise.resolve({
    setup: [
      {
        name: "tally",
        value: TALLY,
      },
      {
        name: "rewardManager",
        value: address("RewardManager"),
      },
      {
        name: "tokenManager",
        value: address("TokenManager"),
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
