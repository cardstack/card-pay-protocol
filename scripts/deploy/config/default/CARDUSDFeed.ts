import { Contract } from "ethers";
import { getAddress, AddressFile, ContractConfig } from "../../config-utils";

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  return Promise.resolve({
    setup: [
      {
        name: "description",
        value: "ETH",
      },
      {
        name: "decimals",
        value: 8,
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
    addRound: {
      round: {
        mapping: "latestRoundData",
        getterFunc: async (contract: Contract) => {
          try {
            let result = await contract.latestRoundData();
            return result.answer;
          } catch (e) {
            return null;
          }
        },
        value: "1186000",
        params: ["1186000", "1618433281", "1618433281"],
      },
    },
  });
}
