const { asyncMain } = require("./deploy/util.js");
const { verifyImpl } = require("../lib/verify");

async function main() {
  let contractAtAddress = process.env.CONTRACT;
  if (!contractAtAddress) {
    console.error(
      "Must set CONTRACT environment variable to ContractName@hexaddresss"
    );
    process.exit(1);
  }
  let [contractName, address] = contractAtAddress.split("@");
  console.log("args: " + JSON.stringify(process.argv));
  if (!contractName || !address) {
    console.log(
      "Please provide CONTRACT environment variable as ContractName@hexaddresss"
    );
    process.exit(1);
  }

  await verifyImpl(contractName, address);
}

asyncMain(main);
