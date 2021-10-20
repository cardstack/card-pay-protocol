import { nextVersion } from "../../lib/release-utils";

const nextVer = process.env.CARDPAY_VERSION || "patch";
const version = nextVersion(nextVer);
console.log(`setting cardpay protocol version to ${version}`);

// TODO send txn to VersionManager contract to set version
