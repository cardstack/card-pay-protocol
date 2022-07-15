import { debug as debugFactory } from "debug";
import configureCardProtocol from "./configure-card-protocol";
import deployContracts from "./deploy-contracts";
import hre from "hardhat";
import {
  asyncMain,
  contractInitSpec,
  getDeployAddress,
  getNetwork,
  getProxyAddresses,
  getUpgradeManager,
  reportProtocolStatus,
} from "./util";
import { Contract } from "@ethersproject/contracts";
const debug = debugFactory("card-protocol.deploy");

const { ethers } = hre;

async function main() {
  let network = getNetwork();
  const { pendingChanges, unverifiedImpls } = await deployContracts(network);
  await configureCardProtocol(network, pendingChanges);

  let contracts = contractInitSpec({ network, onlyUpgradeable: true });
  let proxyAddresses = await getProxyAddresses(network);

  for (let [contractId] of Object.entries(contracts)) {
    let proxyAddress = proxyAddresses[contractId].proxy;

    let upgradeManager = (await getUpgradeManager(network)).connect(
      await ethers.getSigner(await getDeployAddress())
    );

    debug("Allowed proposers", await upgradeManager.getUpgradeProposers());

    let newImplementation = pendingChanges.newImplementations[contractId];
    let encodedCall = pendingChanges.encodedCalls[contractId];

    if (!newImplementation && !encodedCall) {
      continue;
    } else if (
      await proposalMatches({
        newImplementation,
        encodedCall,
        proxyAddress,
        upgradeManager,
      })
    ) {
      debug(
        "Already proposed upgrade for",
        contractId,
        "matches, no action needed"
      );
    } else if (newImplementation && encodedCall) {
      debug("Proposing upgrade and call for", contractId);
      await upgradeManager.proposeUpgradeAndCall(
        contractId,
        newImplementation,
        encodedCall
      );
    } else if (newImplementation) {
      debug("Proposing upgrade for", contractId);
      await upgradeManager.proposeUpgrade(contractId, newImplementation);
      debug(`Successfully proposed upgrade`);
    } else if (encodedCall) {
      debug("Proposing call for", contractId);
      await upgradeManager.proposeCall(contractId, encodedCall);
    }
  }

  console.log((await reportProtocolStatus(network)).toString());

  let reverify = [];

  for (let impl of unverifiedImpls) {
    if (!process.env.SKIP_VERIFY) {
      try {
        await hre.run("verify:verify", {
          address: impl,
          constructorArguments: [],
        });
      } catch (e) {
        console.error(e);
      }
    }
    reverify.push(impl);
  }

  if (reverify.length > 0) {
    debug(`
  Implementation contract verification commands:`);
    for (let address of reverify) {
      debug(`npx hardhat verify --network ${network} ${address}`);
    }
  }
}

async function proposalMatches({
  newImplementation,
  encodedCall,
  upgradeManager,
  proxyAddress,
}: {
  newImplementation: string | false;
  encodedCall: string | false;
  upgradeManager: Contract;
  proxyAddress: string;
}) {
  if (newImplementation) {
    let pendingAddress = await upgradeManager.getPendingUpgradeAddress(
      proxyAddress
    );
    if (pendingAddress !== newImplementation) {
      return false;
    }
  }

  if (encodedCall) {
    let pendingCallData = await upgradeManager.getPendingCallData(proxyAddress);
    if (pendingCallData !== encodedCall) {
      return false;
    }
  }
  return true;
}

asyncMain(main);
