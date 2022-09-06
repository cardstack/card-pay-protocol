import { debug as debugFactory } from "debug";
import { BigNumber } from "ethers";
import { ethers, upgrades } from "hardhat";
import isEqual from "lodash/isEqual";
import { ZERO_ADDRESS } from "./config-utils";
import {
  assert,
  asyncMain,
  confirm,
  decodeEncodedCall,
  encodeWithSignature,
  getNetwork,
  getUpgradeManager,
  patchNetworks,
} from "./util";

const debug = debugFactory("card-protocol.safe");

patchNetworks();

const {
  erc1967: { getAdminAddress },
} = upgrades;

let network = getNetwork();

async function main() {
  let config = getConfig();

  let upgradeManager = await getUpgradeManager(network);
  let upgradeManagerOwner = await upgradeManager.owner();
  debug("Upgrade manager address", upgradeManager.address);
  debug("UpgradeManager owner:", upgradeManagerOwner);

  let upgradeManagerAdminAddress = await getAdminAddress(
    upgradeManager.address
  );
  debug("Upgrade manager admin address", upgradeManagerAdminAddress);

  let proxyAdmin = await ethers.getContractAt(
    "IProxyAdmin",
    upgradeManagerAdminAddress
  );

  let proxyAdminOwner = await proxyAdmin.owner();
  debug("Proxy admin owner", proxyAdminOwner);
  assert(
    proxyAdminOwner == upgradeManager.address,
    "The upgrade manager proxy admin owner should be the upgrade manager itself"
  );

  let gnosisSafeProxyFactory = await ethers.getContractAt(
    "GnosisSafeProxyFactory",
    process.env.GNOSIS_SAFE_FACTORY
  );

  let encodedSetupCall = encodeWithSignature(
    "setup(address[],uint256,address,bytes,address,address,uint256,address)",
    config.NEW_SAFE_OWNERS,
    config.NEW_SAFE_THRESHOLD,
    ZERO_ADDRESS,
    "0x",
    ZERO_ADDRESS,
    ZERO_ADDRESS,
    0,
    ZERO_ADDRESS
  );

  if (
    !(await confirm(
      `Setup call for gnosis safe:
        ${decodeEncodedCall(
          await ethers.getContractFactory("GnosisSafe"),
          encodedSetupCall
        )}
      `
    ))
  ) {
    process.exit(0);
  }

  let tx = await gnosisSafeProxyFactory.createProxy(
    config.GNOSIS_SAFE_MASTER_COPY,
    encodedSetupCall
  );

  let receipt = await tx.wait();

  let creationEvent = receipt.events.find((e) => e.event === "ProxyCreation");

  let safeAddress = creationEvent.args.proxy;

  debug("Created safe at address", safeAddress);

  let safe = await ethers.getContractAt("GnosisSafe", safeAddress);
  let newSafeOwners = await safe.getOwners();

  assert(
    isEqual(
      newSafeOwners.slice().sort(),
      (config.NEW_SAFE_OWNERS as Array<string>).sort()
    ),
    "New safe does not have expected owners, aborting"
  );

  assert(
    ((await safe.getThreshold()) as BigNumber).eq(
      config.NEW_SAFE_THRESHOLD as number
    ),
    "New safe does not have expected threshold, aborting"
  );

  tx = await upgradeManager.transferOwnership(safeAddress);
  await tx.wait();

  assert(
    (await upgradeManager.owner()).toLowerCase() == safeAddress.toLowerCase(),
    "Ownership transfer failed"
  );

  debug("Ownership of upgrade manager transferred to safe at", safeAddress);
}

function getConfig() {
  let config: { [name: string]: unknown } = {};

  getEnvVar(config, "GNOSIS_SAFE_FACTORY");
  getEnvVar(config, "GNOSIS_SAFE_MASTER_COPY");
  getEnvVar(config, "NEW_SAFE_OWNERS", (v) => v.split(","));
  getEnvVar(config, "NEW_SAFE_THRESHOLD", (v) => parseInt(v, 10));

  return config;
}

function getEnvVar(config, name, transform = (x) => x) {
  let value = process.env[name];
  assert(!!value?.length, `${name} env var must be set`);

  config[name] = transform(process.env[name]);

  debug(name, ":", config[name]);
}

asyncMain(main);
