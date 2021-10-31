import { resolve, basename, join, sep as fileSeparator } from "path";
import merge from "lodash/merge";
import { existsSync } from "fs";
import glob from "glob-promise";
import dotenv from "dotenv";
import hre from "hardhat";
import isEqual from "lodash/isEqual";
import retry from "async-retry";
import { makeFactory, patchNetworks, asyncMain, readAddressFile } from "./util";
import { AddressFile, ContractConfig, Formatter, Value } from "./config-utils";

patchNetworks();

const {
  network: { name: network },
} = hre;
dotenv.config({ path: resolve(process.cwd(), `.env.${network}`) });

const sendTx = async function (cb) {
  return await retry(cb, { retries: 3 });
};

async function main(proxyAddresses: AddressFile) {
  proxyAddresses = proxyAddresses || readAddressFile(network);

  const configFiles: string[] = await glob(`${__dirname}/config/**/*.ts`);
  const configs = configFiles.map((file) => basename(file));

  const deployConfig = new Map(
    await Promise.all(
      configs.map(async (configModule) => {
        const name = configModule.replace(".ts", "");
        const config = await getConfig(configModule, proxyAddresses);
        return [name, config] as [string, ContractConfig];
      })
    )
  );

  for (const [contractId, config] of deployConfig.entries()) {
    if (!proxyAddresses[contractId]) {
      console.log(`Skipping ${contractId} for network ${network}`);
      continue;
    }

    const { contractName, proxy: address } = proxyAddresses[contractId];
    const contractFactory = await makeFactory(contractName);
    const contract = await contractFactory.attach(address);
    let contractUnchanged = true;
    console.log(`
Detecting config changes for ${contractId} (${address})`);
    for (const [setter, args] of Object.entries(config)) {
      if (Array.isArray(args)) {
        let stateChanged = false;
        for (let { name, value, propertyField, formatter } of args) {
          const rawValue = await contract[name]();
          let currentValue;
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
          printSend(contractId, setter, values);
          await sendTx(async () => contract[setter](...values));
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
          },
        ] of Object.entries(args)) {
          let queryKey = keyTransform ? keyTransform(key) : key;
          if (getterParams) {
            getterParams = replaceParams(getterParams, queryKey, value);
          } else {
            getterParams = [queryKey];
          }
          const rawValue = await contract[property](...getterParams);
          let currentValue;
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
            const params = replaceParams(paramsTemplate, key, value);
            printDiff(currentValue, value, property, formatter, key);
            printSend(contractId, setter, params);
            await sendTx(async () => contract[setter](...params));
          }
        }
      }
    }

    if (contractUnchanged) {
      console.log(`  no changes`);
    }
  }

  console.log(`
Completed configurations
`);
}

async function getConfig(
  moduleName: string,
  proxyAddresses: AddressFile
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
    console.log(`  mapping "${propertyName}(${propertyKey})":
    ${JSON.stringify(currentValue)}${
      currentFormatted ? " (" + currentFormatted + ")" : ""
    } => ${JSON.stringify(desiredValue)}${
      desiredFormatted ? " (" + desiredFormatted + ")" : ""
    }`);
  } else {
    console.log(`  property "${propertyName}":
    ${JSON.stringify(currentValue)}${
      currentFormatted ? " (" + currentFormatted + ")" : ""
    } => ${isSet ? "add item to set: " : ""} ${JSON.stringify(desiredValue)}${
      desiredFormatted ? " (" + desiredFormatted + ")" : ""
    }`);
  }
}

function printSend(
  contractId: string,
  setter: string,
  params: (Value | Value[])[]
) {
  console.log(
    `  Calling ${contractId}.${setter}() with arguments:
    ${params.map((v) => JSON.stringify(v)).join(",\n    ")}`
  );
}

//eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(value: any) {
  if (Array.isArray(value)) {
    return value.map((v) => normalize(v));
  } else {
    const valueStr = value.toString();
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

asyncMain(main);
