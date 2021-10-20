import {
  getAddress,
  AddressFile,
  ContractConfig,
  GNOSIS_SAFE_MASTER_COPY,
  GNOSIS_SAFE_FACTORY,
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
        name: "bridgeUtils",
        value: address("BridgeUtils"),
      },
      {
        name: "gnosisSafe",
        value: GNOSIS_SAFE_MASTER_COPY,
      },
      {
        name: "gnosisProxyFactory",
        value: GNOSIS_SAFE_FACTORY,
      },
    ],
  });
}
