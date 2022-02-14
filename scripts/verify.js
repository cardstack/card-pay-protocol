const { asyncMain } = require("./deploy/util.js");
const { verifyImpl } = require("../lib/verify");
const hardhat = require("hardhat");
const { ethers } = hardhat;

// bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
const IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function main() {
  let contractAtAddress = process.env.CONTRACT;

  if (contractAtAddress) {
    let [contractName, address] = contractAtAddress.split("@");
    if (!contractName || !address) {
      console.log(
        "Please provide CONTRACT environment variable as ContractName@hexaddresss"
      );
      process.exit(1);
    }

    console.log("Verifying", contractName, "at", address);
    await verifyImpl(contractName, address);
  } else {
    console.log(
      "No CONTRACT environment variable provided, verifying all contracts"
    );

    let addresses = require(`../.openzeppelin/addresses-${hardhat.network.name}`);

    for (let contractLabel of Object.keys(addresses)) {
      let { proxy, contractName } = addresses[contractLabel];

      let implementationAddress =
        "0x" + (await ethers.provider.getStorageAt(proxy, IMPL_SLOT)).slice(26);

      console.log("Verifying", contractName, "at", implementationAddress);
      await verifyImpl(contractName, implementationAddress);
    }
  }
}

asyncMain(main);
