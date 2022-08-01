import { Contract } from "@ethersproject/contracts";
import { debug as debugFactory } from "debug";
import { readJSONSync } from "fs-extra";
import glob from "glob";
import hre from "hardhat";
import difference from "lodash/difference";
import { shuffle } from "lodash";
import { PendingChanges, ZERO_ADDRESS } from "./config-utils";
import {
  contractInitSpec,
  deployedCodeMatches,
  deployedImplementationMatches,
  deployNewProxyAndImplementation,
  getDeployAddress,
  getOrDeployUpgradeManager,
  getSigner,
  makeFactory,
  readMetadata,
  retry,
  writeMetadata,
} from "./util";

const {
  upgrades: {
    prepareUpgrade,
    erc1967: { getAdminAddress },
  },
  ethers,
} = hre;

const debug = debugFactory("card-protocol.deploy");

export default async function (
  network: string
): Promise<{ unverifiedImpls: string[]; pendingChanges: PendingChanges }> {
  const owner = await getDeployAddress();
  debug(`Deploying from address ${owner}`);

  const pendingChanges: PendingChanges = {
    newImplementations: {},
    encodedCalls: {},
  };

  let previousImpls = implAddresses(network);

  let upgradeManager = await getOrDeployUpgradeManager(network, owner);
  let contracts = contractInitSpec({ network, owner: upgradeManager.address });

  // Contracts are shuffled to deploy in random order, as a workaround to issues
  // deploying to sokol
  for (let [contractId, { contractName, init, nonUpgradeable }] of shuffle(
    Object.entries(contracts)
  )) {
    debug("Contract:", contractId);

    init = await Promise.all(
      init.map(async (i) => {
        if (typeof i !== "string") {
          return i;
        }
        let iParts = i.split(".");
        if (iParts.length === 1) {
          return i;
        }
        let [id, prop] = iParts;
        switch (prop) {
          case "address": {
            let address = await upgradeManager.adoptedContractAddresses(id);
            if (address == ZERO_ADDRESS) {
              throw new Error(
                `The address for contract ${id} has not been derived yet. Cannot initialize ${contractId} with ${i}`
              );
            }
            return address;
          }
          default:
            throw new Error(
              `Do not know how to handle property "${prop}" from ${i} when processing the init args for ${contractId}`
            );
        }
      })
    );

    let proxyAddress = await upgradeManager.adoptedContractAddresses(
      contractId
    );

    if (proxyAddress !== ZERO_ADDRESS && !nonUpgradeable) {
      debug(`Checking ${contractId} (${contractName}@${proxyAddress}) ...`);

      if (await deployedCodeMatches(contractName, proxyAddress)) {
        debug(
          `Deployed bytecode already matches for ${contractName}@${proxyAddress} - no need to deploy new version`
        );
      } else {
        debug(
          `Bytecode changed for ${contractName}@${proxyAddress}... Proposing upgrade`
        );

        if (process.env.DRY_RUN) {
          pendingChanges.newImplementations[contractId] = "<Unknown - dry run>";
        } else {
          let factory = await makeFactory(contractName);

          let newImplementationAddress: string = (await prepareUpgrade(
            proxyAddress,
            factory
          )) as string;

          pendingChanges.newImplementations[contractId] =
            newImplementationAddress;
        }
      }
    } else if (nonUpgradeable) {
      // if the contract is not upgradeable, deploy a new version each time.
      // Deploying a new version each time probably only makes sense for contracts
      // that are used as delegate implementations, and it is done so that when
      // changes are made to that contract, a new one is deployed and other contracts
      // are configured to point to it later.

      // This behaviour makes sense for RewardSafeDelegateImplementation,
      // however it may not make sense for other non-upgradeable contracts in the future

      proxyAddress = readMetadata(`${contractId}Address`, network);
      if (
        proxyAddress &&
        (await deployedImplementationMatches(contractName, proxyAddress))
      ) {
        debug(
          "Deployed implementation of",
          contractName,
          "is already up to date"
        );
      } else {
        debug(
          `Deploying new non upgradeable contract ${contractId} (${contractName})...`
        );

        if (!process.env.DRY_RUN) {
          let factory = await makeFactory(contractName);
          let instance: Contract;

          await retry(async () => {
            instance = await factory.deploy(...init);
          });
          debug(
            `Deployed new non upgradeable contract ${contractId} (${contractName}) to ${instance.address}`
          );
          writeMetadata(`${contractId}Address`, instance.address, network);
        }
      }
    } else {
      debug(`Deploying new contract ${contractId} (${contractName})...`);

      if (!process.env.DRY_RUN) {
        let instance = await deployNewProxyAndImplementation(
          contractName,
          init
        );

        debug(
          `Deployed new proxy for ${contractId} (contract name: ${contractName}) to address ${instance.address}, adopting`
        );

        let proxyAdminAddress = await getAdminAddress(instance.address);

        let proxyAdmin = await ethers.getContractAt(
          "IProxyAdmin",
          proxyAdminAddress,
          getSigner(await getDeployAddress())
        );

        let proxyAdminOwner = await proxyAdmin.owner();
        if (proxyAdminOwner !== upgradeManager.address) {
          debug(
            `Proxy admin ${proxyAdmin.address} is not owned by upgrade manager, it is owned by ${proxyAdminOwner}, transferring`
          );
          await proxyAdmin.transferOwnership(upgradeManager.address);
        }

        await upgradeManager.adoptContract(
          contractId,
          instance.address,
          proxyAdminAddress
        );

        debug("New contract", contractId, "adopted successfully");
      }
    }
  }

  if ((await upgradeManager.versionManager()) === ZERO_ADDRESS) {
    let versionManagerAddress = await upgradeManager.adoptedContractAddresses(
      "VersionManager"
    );
    debug(
      "Upgrade Manager not setup, setting up now with proposer",
      owner,
      "and version manager",
      versionManagerAddress
    );
    await retry(
      async () => await upgradeManager.setup([owner], versionManagerAddress)
    );
  }

  let unverifiedImpls = difference(implAddresses(network), previousImpls);

  return {
    unverifiedImpls,
    pendingChanges,
  };
}

function implAddresses(network: string) {
  let networkId: number;
  switch (network) {
    case "sokol":
      networkId = 77;
      break;
    case "xdai":
      networkId = 100;
      break;
    case "hardhat":
    case "localhost":
      networkId = 31337;
      break;
    default:
      throw new Error(`Do not know network ID for network ${network}`);
  }
  let [file] = glob.sync(`./.openzeppelin/*-${networkId}.json`);
  if (!file) {
    return [];
  }
  let json = readJSONSync(file);
  return Object.values(json.impls).map(
    (i) => (i as { address: string }).address
  );
}
