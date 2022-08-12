import { debug as debugFactory } from "debug";
import { Contract } from "ethers";
import { ethers, upgrades } from "hardhat";
import sokolAddresses from "../../.openzeppelin/addresses-sokol.json";
import xdaiAddresses from "../../.openzeppelin/addresses-xdai.json";
import {
  asyncMain,
  contractWithSigner,
  getDeployAddress,
  getNetwork,
  getOrDeployUpgradeManager,
  getSigner,
  patchNetworks,
  retry,
  writeMetadata,
} from "./util";

const debug = debugFactory("card-protocol.adopt");

patchNetworks();

const {
  erc1967: { getAdminAddress },
} = upgrades;

let network = getNetwork();
let addresses: { [x: string]: { contractName: string; proxy: string } };
switch (network) {
  case "sokol":
    addresses = sokolAddresses;
    break;
  case "xdai":
    addresses = xdaiAddresses;
    break;
}

let contractIds = Object.keys(addresses);

async function main() {
  let versionManager = await ethers.getContractAt(
    "VersionManager",
    addresses.VersionManager.proxy
  );

  let owner = await versionManager.owner();

  let upgradeManager = await getOrDeployUpgradeManager(network, owner);
  let deployAddress = await getDeployAddress();

  versionManager = await contractWithSigner(versionManager, deployAddress);
  upgradeManager = await contractWithSigner(upgradeManager, deployAddress);

  let upgradeProposers = [deployAddress];

  if ((await versionManager.owner()) !== upgradeManager.address) {
    debug("Transferring versionManager ownership to", upgradeManager.address);
    await versionManager.transferOwnership(upgradeManager.address);
  }

  if (
    (await upgradeManager.versionManager()) !== versionManager.address ||
    JSON.stringify(await upgradeManager.getUpgradeProposers()) !==
      JSON.stringify(upgradeProposers)
  ) {
    debug(
      `Setting up upgradeManager with initial proposer ${upgradeProposers} and version manager ${versionManager.address}`
    );
    await upgradeManager.setup(upgradeProposers, versionManager.address);
  }

  // This verifies we're talking a live upgradeManager contract
  let cardPayVersion = await upgradeManager.cardpayVersion();
  debug(`Cardpay version from upgradeManager: ${cardPayVersion}`);

  let upgradeManagerProxyAdminAddress = await getAdminAddress(
    upgradeManager.address
  );

  let upgradeManagerProxyAdmin = await ethers.getContractAt(
    "IProxyAdmin",
    upgradeManagerProxyAdminAddress
  );

  let upgradeManagerProxyOwner = await upgradeManagerProxyAdmin.owner();
  assert(
    upgradeManagerProxyOwner === deployAddress ||
      upgradeManagerProxyOwner === upgradeManager.address,
    `The upgrade manager ProxyAdmin is not owner by the deployer or the upgrade manager itself, it is owned by ${upgradeManagerProxyOwner}`
  );
  assert(
    (await upgradeManager.owner()) === deployAddress,
    "The upgrade manager is not owner by the deployer"
  );

  debug(`Adopting ${contractIds.length} contracts`);

  for (let contractId of contractIds) {
    let { contract, proxyAdmin } = await getDeployedContract(contractId);
    if (contractId === "RewardSafeDelegateImplementation") {
      // Not an upgradeable contract in the sense we mean here

      writeMetadata(
        "RewardSafeDelegateImplementationAddress",
        contract.address,
        network
      );
      continue;
    }
    debug(`Contract: ${contractId}`);
    let owner = await contract.owner();
    let proxyAdminOwner = await proxyAdmin.owner();

    debug(`  - Contract storage: ${contract.address}`);
    debug(`  - Owner: ${owner}`);
    debug(`  - ProxyAdmin: ${proxyAdmin.address}`);
    debug(`  - ProxyAdmin Owner: ${proxyAdminOwner}`);

    let existingContractId = await upgradeManager.getAdoptedContractId(
      contract.address
    );

    if (existingContractId) {
      debug("  - This contract is already adopted");
    } else {
      if (owner !== upgradeManager.address) {
        debug(
          "  - Owner is not upgrade manager, reassigning to",
          upgradeManager.address
        );
        await retry(
          async () => await contract.transferOwnership(upgradeManager.address)
        );
      }
      if (proxyAdminOwner !== upgradeManager.address) {
        debug(
          "  - ProxyAdmin owner is not upgrade manager, reassigning to",
          upgradeManager.address
        );
        await retry(
          async () => await proxyAdmin.transferOwnership(upgradeManager.address)
        );
      }

      debug("Adopting contract");
      await retry(
        async () =>
          await upgradeManager.adoptContract(
            contractId,
            contract.address,
            proxyAdmin.address
          )
      );
      debug("Adoption successful");
    }
  }
}

async function getDeployedContract(id: string): Promise<{
  contract: Contract;
  proxyAdmin: Contract;
}> {
  let signer = getSigner(await getDeployAddress());
  let name = addresses[id].contractName;
  let proxyAddress = addresses[id].proxy;

  let contract = await ethers.getContractAt(name, proxyAddress, signer);

  let proxyAdminAddress = await getAdminAddress(proxyAddress);

  let proxyAdmin = await ethers.getContractAt(
    "IProxyAdmin",
    proxyAdminAddress,
    signer
  );

  return {
    contract,
    proxyAdmin,
  };
}

function assert(test, message) {
  if (!test) {
    throw new Error(message);
  }
}

asyncMain(main);
