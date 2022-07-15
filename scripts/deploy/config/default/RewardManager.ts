import {
  getAddress,
  AddressFile,
  ContractConfig,
  GNOSIS_SAFE_MASTER_COPY,
  GNOSIS_SAFE_FACTORY,
  REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
  GOVERNANCE_ADMIN,
} from "../../config-utils";
import { getDeployAddress, readMetadata } from "../../util";

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  let deployer = await getDeployAddress();

  const REWARD_FEE_RECEIVER = process.env.REWARD_FEE_RECEIVER ?? deployer;
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
        name: "rewardFeeReceiver",
        value: REWARD_FEE_RECEIVER,
      },
      {
        name: "rewardProgramRegistrationFeeInSPEND",
        value: REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND,
      },
      {
        name: "getEip1271Contracts",
        value: [address("RewardPool")],
      },
      {
        name: "governanceAdmin",
        value: GOVERNANCE_ADMIN,
      },
      {
        name: "safeDelegateImplementation",
        value: readMetadata("RewardSafeDelegateImplementationAddress"),
      },
      {
        name: "versionManager",
        value: address("VersionManager"),
      },
    ],
  });
}
