export interface AddressFile {
  [contractId: string]: {
    proxy: string;
    contractName: string;
  };
}

export interface ContractConfig {
  [functionName: string]: PropertyConfig[] | MappingConfig;
}

export interface PropertyConfig {
  name: string;
  value: Value | Value[];
  propertyField?: string;
  formatter?: Formatter;
}

export interface MappingConfig {
  [keyName: string]: {
    mapping: string;
    value: Value;
    params: Value[];
    keyTransform?: Formatter;
    propertyField?: string;
    formatter?: Formatter;
    getterParams?: Value[];
  };
}

export type Formatter = (value: Value) => string;

export type Value = string | number | boolean;

export function getAddress(contractId: string, addresses: AddressFile): string {
  const info = addresses[contractId];
  if (!info?.proxy) {
    throw new Error(
      `Cannot find proxy address for ${contractId} in addresses file`
    );
  }
  return info.proxy;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const GNOSIS_SAFE_MASTER_COPY =
  process.env.GNOSIS_SAFE_MASTER_COPY ??
  "0x6851D6fDFAfD08c0295C392436245E5bc78B0185";
export const GNOSIS_SAFE_FACTORY =
  process.env.GNOSIS_SAFE_FACTORY ??
  "0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B";
export const RELAY_SERVER_TX_SENDER =
  process.env.RELAY_SERVER_TX_SENDER ?? ZERO_ADDRESS;
export const PREPAID_CARD_PROVISIONER = RELAY_SERVER_TX_SENDER;
export const GAS_FEE_RECEIVER = RELAY_SERVER_TX_SENDER;
export const GAS_FEE_CARD_WEI = String(
  process.env.GAS_FEE_CARD_WEI ?? 1000000000000000000
);
export const RATE_DRIFT_PERCENTAGE =
  process.env.RATE_DRIFT_PERCENTAGE ?? 1000000; // 1% (decimals 6)
export const DAI_USD_RATE_SNAP_THRESHOLD =
  process.env.DAI_USD_RATE_SNAP_THRESHOLD ?? 100000000; // +/-1% (decimals 8)
export const MERCHANT_FEE_PERCENTAGE =
  process.env.MERCHANT_FEE_PERCENTAGE ?? 500000; // 0.5%
export const MERCHANT_REGISTRATION_FEE_IN_SPEND =
  process.env.MERCHANT_REGISTRATION_FEE_IN_SPEND ?? 100;

export const BRIDGE_MEDIATOR = process.env.BRIDGE_MEDIATOR ?? ZERO_ADDRESS;
export const PAYABLE_TOKENS = process.env.PAYABLE_TOKENS
  ? process.env.PAYABLE_TOKENS.split(",").map((t) => t.trim())
  : [];
export const TALLY =
  process.env.TALLY ?? "0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B";

export const REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND =
  process.env.REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND ?? 500;

export const GOVERNANCE_ADMIN =
  process.env.GOVERNANCE_ADMIN ?? "0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B";

export const MERCHANT_REGISTRAR = RELAY_SERVER_TX_SENDER;
