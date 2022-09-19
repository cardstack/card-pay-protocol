import dotenv from "dotenv";
import { resolve } from "path";
import {
  asyncMain,
  getDeployAddress,
  getNetwork,
  guessSignatureAndDecode,
  patchNetworks,
  proposedDiff,
  reportProtocolStatus,
  safeTransaction,
} from "./util";
let network = getNetwork();

async function main() {
  patchNetworks();
  dotenv.config({ path: resolve(process.cwd(), `.env.${network}`) });

  switch (process.env.DEPLOY_UTIL) {
    case "status":
      await reportStatus();
      break;
    case "proposed-diff":
      if (!process.env.CONTRACT_ID) {
        throw new Error("Missing CONTRACT_ID env var");
      }
      await proposedDiff(process.env.CONTRACT_ID);
      break;
    case "safe-tx":
      await safeTx();
      break;
    default:
      throw new Error(`Unknown DEPLOY_UTIL: ${process.env.DEPLOY_UTIL}`);
  }
}

async function reportStatus() {
  let { table, anyChanged } = await reportProtocolStatus(network, true);
  console.log(table.toString());

  if (anyChanged) {
    console.log("Exiting with exit code 1 because changes were detected");
    process.exit(1);
  } else {
    console.log("No changes detected to deploy");
  }
}
// Util for executing an arbitrary safe transaction whilst collecting multiple signatures
// ENCODED_SAFE_TX: encoded data, e.g.:

// let encodedSafeTx = (await ethers.getContractAt("Foo", "0x123")).interface.encodeFunctionData("bar", [
//   123,
//   "456",
// ]);

// PRIOR_SIGNATURES: json encoded prior safe transaction signatures

// SAFE_ADDRESS: address of safe to send tx from

// SAFE_TX_TO: address of contract the encoded call should be sent to

async function safeTx() {
  let data = process.env.ENCODED_SAFE_TX;
  if (!data) {
    console.log("ENCODED_SAFE_TX env var missing");
    process.exit(1);
  }

  let safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress) {
    console.log("SAFE_ADDRESS env var missing");
    process.exit(1);
  }

  let to = process.env.SAFE_TX_TO;
  if (!to) {
    console.log("SAFE_TX_TO env var missing");
    process.exit(1);
  }

  console.log("Safe:", safeAddress);
  console.log("To:", to);
  console.log("Encoded TX:", data);

  await guessSignatureAndDecode(data);
  let deployAddress = await getDeployAddress();

  await safeTransaction({
    signerAddress: deployAddress,
    safeAddress,
    to,
    data,
    priorSignatures: true,
  });
}

asyncMain(main);
