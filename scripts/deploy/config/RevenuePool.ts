import {
  getAddress,
  AddressFile,
  ContractConfig,
  MERCHANT_FEE_PERCENTAGE,
  MERCHANT_REGISTRATION_FEE_IN_SPEND,
} from "../config-utils";
import { getDeployAddress } from "../util";

export default async function (
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  function address(name: string) {
    return getAddress(name, proxyAddresses);
  }
  const deployer = await getDeployAddress();
  const MERCHANT_FEE_RECEIVER = process.env.MERCHANT_FEE_RECEIVER ?? deployer;

  return {
    setup: [
      {
        name: "exchangeAddress",
        value: address("Exchange"),
      },
      {
        name: "merchantManager",
        value: address("MerchantManager"),
      },
      {
        name: "actionDispatcher",
        value: address("ActionDispatcher"),
      },
      {
        name: "prepaidCardManager",
        value: address("PrepaidCardManager"),
      },
      {
        name: "merchantFeeReceiver",
        value: MERCHANT_FEE_RECEIVER,
      },
      {
        name: "merchantFeePercentage",
        value: MERCHANT_FEE_PERCENTAGE,
        formatter: (v) => `${(Number(v) / 1000000).toFixed(4)}%`,
      },
      {
        name: "merchantRegistrationFeeInSPEND",
        value: MERCHANT_REGISTRATION_FEE_IN_SPEND,
      },
    ],
  };
}
