import dotenv from "dotenv";
import { resolve } from "path";
import {
  asyncMain,
  getNetwork,
  patchNetworks,
  proposedDiff,
  reportProtocolStatus,
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

asyncMain(main);
