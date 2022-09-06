import { debug as debugFactory } from "debug";
import { nextVersion } from "../../lib/release-utils";
import { getNetwork } from "./config-utils";
import {
  asyncMain,
  confirm,
  decodeEncodedCall,
  getDeployAddress,
  getSigner,
  getUpgradeManager,
  reportProtocolStatus,
  retry,
  safeTransaction,
} from "./util";

const debug = debugFactory("card-protocol.deploy");

async function main() {
  let network = getNetwork();

  console.log((await reportProtocolStatus(network)).table.toString());

  let deployAddress = await getDeployAddress();

  let upgradeManager = await getUpgradeManager(network);

  let nonce = await upgradeManager.nonce();
  debug("Upgrade Manager nonce for these changes:", nonce.toString());

  const nextVer = process.env.CARDPAY_VERSION || "patch";
  let currentVersion = await upgradeManager.cardpayVersion();
  const newVersion = nextVersion(nextVer);

  if (
    !(await confirm(
      `Confirm ${nextVer} upgrade of protocol with above changes (${currentVersion} -> ${newVersion})?`
    ))
  ) {
    debug("Cancelling upgrade");
    process.exit(1);
  }
  let upgradeManagerOwner = await upgradeManager.owner();

  if (upgradeManagerOwner === deployAddress) {
    debug(
      `The upgrade manager is owned by the active deploy address ${deployAddress}; Sending a regular upgrade transaction`
    );
    await retry(
      async () =>
        await upgradeManager
          .connect(getSigner(deployAddress))
          .upgradeProtocol(newVersion, nonce)
    );
    debug("Success");
  } else {
    debug(
      `Owner of the upgrade manager is not the active deploy address, attempting safe transaction`
    );

    let data = upgradeManager.interface.encodeFunctionData("upgradeProtocol", [
      newVersion,
      nonce,
    ]);

    debug(
      `Preparing to call function on UpgradeManager@${upgradeManager.address} via safe:\n`,
      decodeEncodedCall(upgradeManager, data)
    );

    await safeTransaction({
      signerAddress: deployAddress,
      safeAddress: upgradeManagerOwner,
      to: upgradeManager.address,
      data,
      priorSignatures: true,
    });
  }
}

asyncMain(main);
