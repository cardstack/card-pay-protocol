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
  getSigner,
  getUpgradeManager,
  reportProtocolStatus,
  retryAndWaitForNonceIncrease,
} from "./util";

import { Contract } from "@ethersproject/contracts";
import { ZERO_ADDRESS } from "./config-utils";
const debug = debugFactory("card-protocol.deploy");

async function main() {
  let network = getNetwork();
  let deployAddress = await getDeployAddress();

  const { pendingChanges, unverifiedImpls } = await deployContracts(network);

  await configureCardProtocol(network, pendingChanges);

  let contracts = contractInitSpec({ network, onlyUpgradeable: true });
  let proxyAddresses = await getProxyAddresses(network);

  let upgradeManager = (await getUpgradeManager(network)).connect(
    getSigner(deployAddress)
  );

  let alreadyPending = await upgradeManager.getProxiesWithPendingChanges();

  for (let [contractId] of Object.entries(contracts)) {
    let proxyAddress = proxyAddresses[contractId].proxy;

    let newImplementation = pendingChanges.newImplementations[contractId];
    let encodedCall = pendingChanges.encodedCalls[contractId];

    let proposeWithWithdrawIfNeeded = async function (cb) {
      if (alreadyPending.includes(proxyAddress)) {
        debug("Withdraw needed first for", contractId);
        await upgradeManager.withdrawChanges(contractId);
      }
      return await retryAndWaitForNonceIncrease(cb);
    };

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
      await proposeWithWithdrawIfNeeded(
        async () =>
          await upgradeManager.proposeUpgradeAndCall(
            contractId,
            newImplementation,
            encodedCall
          )
      );
    } else if (newImplementation) {
      debug("Proposing upgrade for", contractId);
      await proposeWithWithdrawIfNeeded(
        async () =>
          await upgradeManager.proposeUpgrade(contractId, newImplementation)
      );
      debug(`Successfully proposed upgrade`);
    } else if (encodedCall) {
      debug("Proposing call for", contractId);
      await proposeWithWithdrawIfNeeded(
        async () => await upgradeManager.proposeCall(contractId, encodedCall)
      );
    }
  }

  console.log((await reportProtocolStatus(network)).table.toString());

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
  let pendingAddress = await upgradeManager.getPendingUpgradeAddress(
    proxyAddress
  );
  if (pendingAddress === ZERO_ADDRESS) {
    pendingAddress = undefined;
  }

  if (pendingAddress !== newImplementation) {
    return false;
  }

  let pendingCallData = await upgradeManager.getPendingCallData(proxyAddress);
  if (pendingCallData === "0x") {
    pendingCallData = undefined;
  }
  if (pendingCallData !== encodedCall) {
    return false;
  }
  return true;
}

asyncMain(main);
