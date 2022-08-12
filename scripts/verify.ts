import { asyncMain, contractInitSpec, readMetadata } from "./deploy/util";
import { isVerifiedBlockscout } from "../lib/verify";
import hardhat from "hardhat";

const {
  upgrades: {
    erc1967: { getImplementationAddress },
  },
  network: { name: network },
  ethers,
} = hardhat;

async function main() {
  console.log("verifying all contracts");

  let upgradeManagerAddress = readMetadata("upgradeManagerAddress", network);

  let upgradeManager = await ethers.getContractAt(
    "UpgradeManager",
    upgradeManagerAddress
  );

  let contracts = contractInitSpec({ network, onlyUpgradeable: false });

  for (let proxyAddress of await upgradeManager.getProxies()) {
    let contractId = await upgradeManager.getAdoptedContractId(proxyAddress);
    let contractName = contracts[contractId].contractName;

    let implementationAddress = await getImplementationAddress(proxyAddress);

    if (
      implementationAddress === "0x0000000000000000000000000000000000000000"
    ) {
      // Currently only RewardSafeDelegateImplementation, but this would apply
      // for any non upgradeable contract
      implementationAddress = proxyAddress;
    } else {
      console.log("Verifying proxy to", contractName, "at", proxyAddress);
      console.log(
        "Note: this should verify proxy contracts, proxy admin, implementation all at once"
      );
      await verifyAddress(proxyAddress);
    }

    console.log("Verifying", contractName, "at", implementationAddress);

    await verifyAddress(implementationAddress);
  }
}

async function verifyAddress(address: string) {
  if (!(await isVerifiedBlockscout(address))) {
    try {
      await hardhat.run("verify:verify", {
        address: address,
        constructorArguments: [],
      });
    } catch (e) {
      if (
        // some old proxy contracts are unverified and use old solidity versions, skip these proxy contracts for now
        e.message.includes("contract you want to verify was compiled with") ||
        // Ignore already verified contracts
        e.message.includes("Smart-contract already verified.")
      ) {
        console.log(e.message);
        return;
      } else {
        throw e;
      }
    }
  }
}

asyncMain(main);
