import {
  getAddress,
  AddressFile,
  ContractConfig,
  BRIDGE_MEDIATOR,
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
        name: "tokenManager",
        value: address("TokenManager"),
      },
      {
        name: "supplierManager",
        value: address("SupplierManager"),
      },
      {
        name: "exchange",
        value: address("Exchange"),
      },
      {
        name: "bridgeMediator",
        value: BRIDGE_MEDIATOR,
      },
    ],
  });
}
