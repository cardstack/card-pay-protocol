import { nextVersion } from "../../lib/release-utils";
import retry from "async-retry";

import hre from "hardhat";
import { makeFactory, patchNetworks, asyncMain, readAddressFile } from "./util";
import { getAddress } from "./config-utils";

patchNetworks();

const {
  network: { name: network },
} = hre;

async function main(proxyAddresses) {
  proxyAddresses = proxyAddresses || readAddressFile(network);
  const nextVer = process.env.CARDPAY_VERSION || "patch";
  const version = nextVersion(nextVer);
  console.log(
    `
Setting cardpay protocol version to ${version} (${nextVer} release)`
  );

  const VersionManager = await makeFactory("VersionManager");
  const versionManagerAddress = getAddress("VersionManager", proxyAddresses);
  const versionManager = await VersionManager.attach(versionManagerAddress);
  await retry(async () => await versionManager.setVersion(version), {
    retries: 3,
  });
}

if (!["hardhat", "localhost"].includes(network)) {
  asyncMain(main);
}

// this is exported so we can also use this logic in the private network deploy
module.exports = { main };
