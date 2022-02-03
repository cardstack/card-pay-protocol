import retry from "async-retry";
import { debug as debugFactory } from "debug";
import { Contract } from "ethers";
import { readFileSync, writeFileSync } from "fs";
import hre, { ethers } from "hardhat";
import { resolve } from "path";
import sokolAddresses from "../../.openzeppelin/addresses-sokol.json";
import xdaiAddresses from "../../.openzeppelin/addresses-xdai.json";
import { nextVersion } from "../../lib/release-utils";
import {
  migrateContract,
  proxyAdminInterface,
  PROXY_ADMIN_SLOT,
  sortContracts,
  UpgradeSlot,
} from "../../test/migration/util";
import { getAddress } from "../deploy/config-utils";
import {
  asyncMain,
  getSigner,
  makeFactory,
  patchNetworks,
} from "../deploy/util";

const debug = debugFactory("card-protocol.migration");

patchNetworks();

const {
  network: { name: network },
} = hre;
let sourceNetwork: string;

if (network === "localhost") {
  sourceNetwork = process.env.HARDHAT_FORKING;
  if (!sourceNetwork) {
    throw new Error(
      `HARDHAT_FORKING env var must be set when forking localhost`
    );
  }
} else {
  sourceNetwork = network;
}

let addresses: { [x: string]: { contractName: string; proxy: string } };
switch (sourceNetwork) {
  case "sokol":
    addresses = sokolAddresses;
    break;
  case "xdai":
    addresses = xdaiAddresses;
    break;
}

const CONTRACTS = sortContracts(
  Object.keys(addresses || {}).filter(
    // the delegate implementation is not upgradeable in the same way as other contracts
    (c) => c !== "RewardSafeDelegateImplementation"
  )
);

async function main() {
  debug(`Migrating ${CONTRACTS.length} contracts`);

  let chainId = getChainId();
  const metaFile = resolve(
    __dirname,
    "..",
    "..",
    ".openzeppelin",
    `unknown-${chainId}.json`
  );

  const metaBackupFile = resolve(
    __dirname,
    "..",
    "..",
    ".openzeppelin",
    `unknown-${chainId}-${Date.now()}.json.bak`
  );

  const mappingFile = resolve(
    __dirname,
    "..",
    "..",
    ".openzeppelin",
    `upgrade-mapping-${chainId}.json`
  );

  let metadata = JSON.parse(readFileSync(metaFile, "utf-8"));
  writeFileSync(metaBackupFile, JSON.stringify(metadata, null, 2));

  const mapping = JSON.parse(readFileSync(mappingFile, "utf-8"));

  for (let contractName of CONTRACTS) {
    let { contract, proxyAdmin } = await getDeployedContract(contractName);
    let owner = await contract.owner();
    debug(`Contract: ${contractName}`);
    debug(`Contract storage: ${contract.address}`);
    debug(`Owner: ${owner}`);

    if (network === "localhost") {
      await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [owner],
      });
      await hre.network.provider.request({
        method: "hardhat_setBalance",
        params: [owner, "0xfffffffffffffffffffffffffffffff"],
      });

      let signer = await ethers.getSigner(owner);
      contract = contract.connect(signer);
      proxyAdmin = proxyAdmin.connect(signer);
    }

    let alreadyUpgraded = await ethers.provider.getStorageAt(
      contract.address,
      UpgradeSlot
    );
    let oldImplementation: string;
    if (
      alreadyUpgraded ===
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    ) {
      debug(`Already upgraded ${contractName}`);
    } else {
      oldImplementation = await proxyAdmin.getProxyImplementation(
        contract.address
      );

      debug(`Old implementation: ${oldImplementation}`);
      let implKey = mapping[oldImplementation];
      if (!implKey) {
        throw new Error(`Could not find implKey for ${contractName}`);
      }
      let impl = metadata.impls[implKey];

      if (!impl) {
        throw new Error(`Could not find impl meta for ${implKey}`);
      }

      let { newImplementation, result } = await migrateContract(
        contract,
        contractName,
        proxyAdmin
      );

      debug(`New implementation: ${newImplementation.address}`);

      metadata.impls[implKey].address = newImplementation.address;
      metadata.impls[implKey].txHash = result["hash"];

      writeFileSync(metaFile, JSON.stringify(metadata, null, 2));
    }
  }
}

export async function getDeployedContract(label: string): Promise<{
  contract: Contract;
  proxyAdmin: Contract;
}> {
  let name = addresses[label].contractName;
  let proxyAddress = addresses[label].proxy;

  let contract = await ethers.getContractAt(name, proxyAddress);

  let proxyAdminAddress =
    "0x" +
    (
      await ethers.provider.getStorageAt(contract.address, PROXY_ADMIN_SLOT)
    ).slice(26);

  let proxyAdmin = await ethers.getContractAt(
    proxyAdminInterface,
    proxyAdminAddress
  );

  let signer = getSigner();
  proxyAdmin = proxyAdmin.connect(signer);

  return {
    contract,
    proxyAdmin,
  };
}

function getChainId() {
  if (hre.network.config.chainId) {
    return hre.network.config.chainId;
  } else if (process.env.HARDHAT_FORKING === "sokol") {
    return 77;
  } else if (process.env.HARDHAT_FORKING === "xdai") {
    return 100;
  } else {
    throw new Error("Unknown chainId");
  }
}

asyncMain(main);
