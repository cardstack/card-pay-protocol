import { basename, join, sep as fileSeparator } from "path";
import merge from "lodash/merge";
import { existsSync } from "fs";
import glob from "glob-promise";
import lodashIsEqual from "lodash/isEqual";
import difference from "lodash/difference";
import {
  makeFactory,
  getProxyAddresses,
  contractInitSpec,
  getDeployAddress,
  decodeEncodedCall,
  getUpgradeManager,
  retryAndWaitForNonceIncrease,
} from "./util";
import { debug as debugFactory } from "debug";
const debug = debugFactory("card-protocol.deploy");

import {
  AddressFile,
  ContractConfig,
  Formatter,
  Value,
  ValueOrArrayOfValues,
  PendingChanges,
} from "./config-utils";
import { Contract } from "ethers";

export default async function (
  network: string,
  pendingChanges: PendingChanges
): Promise<void> {
  debug(`Configuring protocol on ${network}`);

  const configFiles: string[] = await glob(`${__dirname}/config/**/*.ts`);
  const configs = configFiles.map((file) => basename(file));

  let proxyAddresses = await getProxyAddresses(network);
  const owner = await getDeployAddress();
  const contracts = contractInitSpec({ network, owner, onlyUpgradeable: true });

  const deployConfig = new Map(
    await Promise.all(
      configs.map(async (configModule) => {
        const name = configModule.replace(".ts", "");
        const config = await getConfig(configModule, proxyAddresses, network);
        return [name, config] as [string, ContractConfig];
      })
    )
  );

  let upgradeManager = await getUpgradeManager(network);

  for (const [contractId, config] of deployConfig.entries()) {
    if (!proxyAddresses[contractId]) {
      debug(`Skipping ${contractId} for network ${network}`);
      continue;
    }

    const { proxy: address } = proxyAddresses[contractId];
    const { contractName } = contracts[contractId];
    const contractFactory = await makeFactory(contractName);
    const contract = contractFactory.attach(address);
    let contractUnchanged = true;
    debug(`\nDetecting config changes for ${contractId} (${address})`);
    for (const [setter, args] of Object.entries(config)) {
      if (Array.isArray(args)) {
        let stateChanged = false;
        for (let { name, value, propertyField, formatter } of args) {
          const rawValue = await contract[name]();
          let currentValue: ValueOrArrayOfValues;
          if (propertyField && typeof rawValue === "object") {
            currentValue = normalize(rawValue[propertyField]);
          } else {
            currentValue = normalize(rawValue);
          }
          if (typeof value === "number") {
            value = value.toString();
          }
          if (!isEqual(currentValue, value)) {
            stateChanged = true;
            contractUnchanged = false;
            printDiff(currentValue, value, name, formatter);
          }
        }
        if (stateChanged) {
          contractUnchanged = false;
          const values = args.map((arg) => arg.value);
          let encodedCall = contract.interface.encodeFunctionData(
            setter,
            values
          );

          await configChanged({
            contractId,
            encodedCall,
            upgradeManager,
            pendingChanges,
            contract,
          });
        }
      } else {
        for (let [
          key,
          {
            mapping: property,
            params: paramsTemplate,
            value,
            propertyField,
            keyTransform,
            formatter,
            getterParams,
            getterFunc,
          },
        ] of Object.entries(args)) {
          let queryKey = keyTransform ? keyTransform(key) : key;
          if (getterParams) {
            getterParams = replaceParams(getterParams, queryKey, value);
          } else {
            getterParams = [queryKey];
          }
          let rawValue: unknown;
          if (getterFunc) {
            rawValue = await getterFunc(contract);
          } else {
            rawValue = await contract[property](...getterParams);
          }
          let currentValue: Value | Value[];
          if (propertyField && typeof rawValue === "object") {
            currentValue = normalize(rawValue[propertyField]);
          } else {
            currentValue = normalize(rawValue);
          }

          if (typeof value === "number") {
            value = value.toString();
          }
          if (
            !(
              // when key and value are the same, then we are dealing with a set
              // and we check for inclusion in that set
              (
                (key === value &&
                  Array.isArray(currentValue) &&
                  currentValue.includes(value)) ||
                isEqual(currentValue, value)
              )
            )
          ) {
            contractUnchanged = false;
            const params = replaceParams(paramsTemplate, key, value);
            printDiff(currentValue, value, property, formatter, key);
            let encodedCall = contract.interface.encodeFunctionData(
              setter,
              params
            );

            await configChanged({
              contractId,
              encodedCall,
              upgradeManager,
              pendingChanges,
              contract,
            });
          }
        }
      }
    }

    if (contractUnchanged) {
      debug(`  no changes`);
    }
  }

  debug(`
Completed configurations
`);
}

async function configChanged({
  contractId,
  encodedCall,
  upgradeManager,
  pendingChanges,
  contract,
}: {
  contractId: string;
  encodedCall: string;
  upgradeManager: Contract;
  pendingChanges: PendingChanges;
  contract: Contract;
}): Promise<void> {
  debug("Calling", contractId, "\n", decodeEncodedCall(contract, encodedCall));

  if (process.env.IMMEDIATE_CONFIG_APPLY) {
    // if there are a large series of calls e.g. during initial setup, it might make more sense
    // to run this script as the owner and perform the config directly, if there are multiple calls for each
    // contract
    debug("Immediate apply");
    await retryAndWaitForNonceIncrease(() =>
      upgradeManager.call(contractId, encodedCall)
    );
  } else {
    pendingChanges.encodedCalls[contractId] = encodedCall;
  }
}
function isEqual(val1, val2): boolean {
  if (Array.isArray(val1) && Array.isArray(val2)) {
    return (
      difference(val1, val2).length === 0 && difference(val2, val1).length === 0
    );
  }
  return lodashIsEqual(val1, val2);
}

async function getConfig(
  moduleName: string,
  proxyAddresses: AddressFile,
  network: string
): Promise<ContractConfig> {
  let networkConfigFile = join(__dirname, "config", network, moduleName);
  let defaultConfigFile = join(__dirname, "config", "default", moduleName);
  let defaultConfig = existsSync(defaultConfigFile)
    ? await importConfig(defaultConfigFile, "default", proxyAddresses)
    : {};
  let networkConfig = existsSync(networkConfigFile)
    ? await importConfig(networkConfigFile, network, proxyAddresses)
    : {};
  return merge({}, defaultConfig, networkConfig);
}

async function importConfig(
  configFile: string,
  configNetwork: string,
  proxyAddresses: AddressFile
): Promise<ContractConfig> {
  const module = configFile.split(fileSeparator).pop().replace(".ts", "");
  const { default: config } = (await import(
    `./config/${configNetwork}/${module}`
  )) as {
    default: (proxyAddresses: AddressFile) => Promise<ContractConfig>;
  };
  return await config(proxyAddresses);
}

function printDiff(
  currentValue: Value | Value[],
  desiredValue: Value | Value[],
  propertyName: string,
  formatter?: Formatter,
  propertyKey?: string
) {
  let currentFormatted: string | undefined;
  let desiredFormatted: string | undefined;
  let isSet = propertyName === desiredValue && Array.isArray(currentValue);
  if (formatter) {
    currentFormatted = Array.isArray(currentValue)
      ? currentValue.map((v) => formatter(v)).join(", ")
      : formatter(currentValue);
    desiredFormatted = Array.isArray(desiredValue)
      ? desiredValue.map((v) => formatter(v)).join(", ")
      : formatter(desiredValue);
  }
  if (propertyKey) {
    debug(`  mapping "${propertyName}(${propertyKey})":
    ${JSON.stringify(currentValue)}${
      currentFormatted ? " (" + currentFormatted + ")" : ""
    } => ${JSON.stringify(desiredValue)}${
      desiredFormatted ? " (" + desiredFormatted + ")" : ""
    }`);
  } else {
    debug(`  property "${propertyName}":
    ${JSON.stringify(currentValue)}${
      currentFormatted ? " (" + currentFormatted + ")" : ""
    } => ${isSet ? "add item to set: " : ""} ${JSON.stringify(desiredValue)}${
      desiredFormatted ? " (" + desiredFormatted + ")" : ""
    }`);
  }
}

//eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(value: any) {
  if (Array.isArray(value)) {
    return value.map((v) => normalize(v));
  } else {
    const valueStr = value && value.toString();
    if (["true", "false"].includes(valueStr)) {
      return valueStr === "true";
    }
    return valueStr;
  }
}

function replaceParams(params: Value[], name: string, value: Value) {
  return params.map((p) => {
    if (p === "{NAME}") {
      return name;
    }
    if (p === "{VALUE}") {
      return value;
    }
    return p;
  });
}
