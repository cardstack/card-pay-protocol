const { readJSONSync, existsSync } = require("node-fs-extra");
const { resolve } = require("path");
const { verifyProxy } = require("./verify");
const network = process.argv.slice(2).pop();
if (!network) {
  console.error("please specify network");
  process.exit(1);
}

const addressesFile = resolve(
  __dirname,
  "..",
  ".openzeppelin",
  `addresses-${network}.json`
);
if (!existsSync(addressesFile)) {
  throw new Error(`Cannot read from the addresses file ${addressesFile}`);
}
let proxyFile = readJSONSync(addressesFile);
let proxyAddresses = Object.values(proxyFile).map(({ proxy }) => proxy);

(async () => {
  for (let address of proxyAddresses) {
    console.log(`verifying proxy ${address}`);
    await verifyProxy(address, network);
  }
})()
  .then(() => {
    console.log("done");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
