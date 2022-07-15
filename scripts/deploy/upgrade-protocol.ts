import { debug as debugFactory } from "debug";
import { ethers } from "hardhat";
import { nextVersion } from "../../lib/release-utils";
import { getNetwork } from "./config-utils";
import {
  asyncMain,
  getDeployAddress,
  getUpgradeManager,
  reportProtocolStatus,
  confirm,
} from "./util";

const debug = debugFactory("card-protocol.deploy");

async function main() {
  let network = getNetwork();

  console.log((await reportProtocolStatus(network)).toString());

  let upgradeManager = (await getUpgradeManager(network)).connect(
    await ethers.getSigner(await getDeployAddress())
  );

  let nonce = await upgradeManager.nonce();
  debug("Upgrade Manager nonce for these changes:", nonce.toString());

  const nextVer = process.env.CARDPAY_VERSION || "patch";
  let currentVersion = await upgradeManager.cardpayVersion();
  const newVersion = nextVersion(nextVer);

  if (
    await confirm(
      `Confirm ${nextVer} upgrade of protocol with above changes (${currentVersion} -> ${newVersion})?`
    )
  ) {
    debug("Upgrading…");
    await upgradeManager.upgradeProtocol(newVersion, nonce);
    debug("Success");
  } else {
    debug("Cancelling upgrade");
  }
}

asyncMain(main);
