const { asyncMain } = require("./deploy/util.js");
const { verifyImpl } = require("../lib/verify");

async function main() {
  let contractAtAddress = process.argv[2];

  let [contractName, address] = contractAtAddress.split("@");

  if (!contractName || !address) {
    console.log("Please provide ContractName@hexaddresss as first argument");
    process.exit(1);
  }

  await verifyImpl(contractName, address);
}

asyncMain(main);
