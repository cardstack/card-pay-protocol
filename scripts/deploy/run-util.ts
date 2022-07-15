import CliTable3 from "cli-table3";
import dotenv from "dotenv";
import { resolve } from "path";
import {
  asyncMain,
  getNetwork,
  patchNetworks,
  reportProtocolStatus,
} from "./util";

async function main() {
  patchNetworks();
  let network = getNetwork();
  dotenv.config({ path: resolve(process.cwd(), `.env.${network}`) });

  let statusWithoutUnchanged: CliTable3.Table;

  switch (process.env.DEPLOY_UTIL) {
    case "status":
      statusWithoutUnchanged = await reportProtocolStatus(network, false);
      console.log((await reportProtocolStatus(network, true)).toString());

      if (statusWithoutUnchanged.length > 0) {
        console.log("Exiting with exit code 1 because changes were detected");
        process.exit(1);
      }
      break;
    default:
      throw new Error(`Unknown DEPLOY_UTIL: ${process.env.DEPLOY_UTIL}`);
  }
}

asyncMain(main);
