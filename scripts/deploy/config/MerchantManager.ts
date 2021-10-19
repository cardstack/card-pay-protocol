import hre from "hardhat";
import {
  getAddress,
  AddressFile,
  ContractConfig,
  GNOSIS_SAFE_MASTER_COPY,
  GNOSIS_SAFE_FACTORY,
} from "../config-utils";

const {
  network: { name: network },
} = hre;
// TODO after the next deploy with these addresses we can just use zero
// address for this
const deprecatedMerchantManager =
  network === "xdai"
    ? "0x3C29B2A563F4bB9D625175bE823c528A4Ddd1107" // v0.6.4+xdai
    : "0xA113ECa0Af275e1906d1fe1B7Bef1dDB033113E2"; // v0.6.7+sokol

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  return Promise.resolve({
    setup: [
      {
        name: "actionDispatcher",
        value: address("ActionDispatcher"),
      },
      {
        name: "gnosisSafe",
        value: GNOSIS_SAFE_MASTER_COPY,
      },
      {
        name: "gnosisProxyFactory",
        value: GNOSIS_SAFE_FACTORY,
      },
      {
        name: "deprecatedMerchantManager",
        value: deprecatedMerchantManager,
      },
    ],
  });
}
