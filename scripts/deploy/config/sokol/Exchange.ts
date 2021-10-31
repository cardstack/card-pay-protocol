import { ethers } from "ethers";
import {
  getAddress,
  AddressFile,
  ContractConfig,
  RATE_DRIFT_PERCENTAGE,
} from "../../config-utils";

const {
  utils: { keccak256, toUtf8Bytes },
} = ethers;

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  return Promise.resolve({
    setup: [
      {
        name: "rateDriftPercentage",
        value: RATE_DRIFT_PERCENTAGE,
        formatter: (v) => `${(Number(v) / 1000000).toFixed(4)}%`,
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],

    createExchange: {
      "DAI.CPXD": {
        mapping: "exchanges",
        value: address("DAIOracle"),
        params: ["{NAME}", "{VALUE}"],
        propertyField: "feed",
        keyTransform: (k) => keccak256(toUtf8Bytes(k.toString())),
      },
      "CARD.CPXD": {
        mapping: "exchanges",
        value: address("CARDOracle"),
        params: ["{NAME}", "{VALUE}"],
        propertyField: "feed",
        keyTransform: (k) => keccak256(toUtf8Bytes(k.toString())),
      },
    },
  });
}
