import retry from "async-retry";
import { debug as debugFactory } from "debug";
import { Contract } from "ethers";
import hre, { ethers } from "hardhat";
import sokolAddresses from "../../.openzeppelin/addresses-sokol.json";
import xdaiAddresses from "../../.openzeppelin/addresses-xdai.json";
import { nextVersion } from "../../lib/release-utils";
import {
  migrateContract,
  proxyAdminInterface,
  PROXY_ADMIN_SLOT,
  sortContracts,
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
      let signer = await ethers.getSigner(owner);
      contract = contract.connect(signer);
      proxyAdmin = proxyAdmin.connect(signer);
    }

    await migrateContract(contract, contractName, proxyAdmin);
  }
  const nextVer = process.env.CARDPAY_VERSION || "patch";
  const version = nextVersion(nextVer);
  console.log(
    `Setting cardpay protocol version to ${version} (${nextVer} release)`
  );

  const VersionManager = await makeFactory("VersionManager");
  const versionManagerAddress = getAddress("VersionManager", addresses);
  const versionManager = await VersionManager.attach(versionManagerAddress);
  await retry(async () => await versionManager.setVersion(version), {
    retries: 3,
  });
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

asyncMain(main);
