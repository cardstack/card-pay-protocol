const { asyncMain } = require("./deploy/util.js");
const { isVerifiedBlockscout } = require("../lib/verify");
const hardhat = require("hardhat");
const { ethers } = hardhat;
const retry = require("async-retry");

// bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
const IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function main() {
  console.log("verifying all contracts");

  let addresses = require(`../.openzeppelin/addresses-${hardhat.network.name}`);

  for (let contractLabel of Object.keys(addresses)) {
    let { proxy, contractName } = addresses[contractLabel];

    let implementationAddress =
      "0x" + (await ethers.provider.getStorageAt(proxy, IMPL_SLOT)).slice(26);

    if (
      implementationAddress === "0x0000000000000000000000000000000000000000"
    ) {
      // Currently only RewardSafeDelegateImplementation, but this would apply
      // for any non upgradeable contract
      implementationAddress = proxy;
    }

    console.log("Verifying", contractName, "at", implementationAddress);
    await retry(
      async () => {
        let alreadyVerified = await isVerifiedBlockscout(implementationAddress);

        if (alreadyVerified) {
          console.log("Already verified, skipping!");
          return;
        }

        await hardhat.run("verify:verify", {
          address: implementationAddress,
          constructorArguments: [],
        });
      },
      { retries: 4, minTimeout: 10000 }
    );
  }
}

asyncMain(main);
