import { Interface } from "@ethersproject/abi";
import axios from "axios";
import dotenv from "dotenv";
import { compact } from "lodash";
import { resolve } from "path";
import {
  assert,
  asyncMain,
  decodeEncodedCallWithInterface,
  getDeployAddress,
  getNetwork,
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

async function guessSignatureAndDecode(txdata: string) {
  try {
    let signature = txdata.slice(0, 10);
    let {
      data: { results },
      status,
    } = await axios.get(
      `https://www.4byte.directory/api/v1/signatures/?hex_signature=${signature}`
    );

    assert(status === 200, "api failed to return response");

    let decodedCalls = compact(
      results.map(({ text_signature }) => {
        let iface = new Interface([`function ${text_signature}`]);
        try {
          return decodeEncodedCallWithInterface(iface, txdata);
        } catch (e) {
          console.log(e);
          return null;
        }
      })
    );

    if (decodedCalls.length) {
      console.log(
        "Found these possible interpretations of the function call:\n\n",
        decodedCalls.join("\n\n")
      );
    } else {
      console.log(
        "Could not find interpretation of function call from public signature db"
      );
    }

    console.log(
      "IMPORTANT: this relies on a public db of 4-byte signatures that are trivial to brute force collisions of. Do not trust these decodes and ensure the txdata you are signing is from a trusted source"
    );
  } catch (e) {
    console.log("Failed to decode txdata, cannot show preview", e);
  }
}

asyncMain(main);
