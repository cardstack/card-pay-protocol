const inc = require("semver/functions/inc");
const coerce = require("semver/functions/coerce");
const { writeJSONSync, readFileSync, writeFileSync } = require("fs-extra");
const { join } = require("path");

const pkgJSONFile = join(__dirname, "..", "package.json");
const cardpayProtocolVersionFile = join(
  __dirname,
  "..",
  "contracts",
  "core",
  "Versionable.sol"
);

function nextVersion(nextVer) {
  let pkgJSON = require(pkgJSONFile);
  let { version } = pkgJSON;
  switch (nextVer) {
    case "patch":
    case "minor":
    case "major":
      version = inc(version, nextVer);
      break;
    case "promote":
      // in this scenario we are just promoting the existing version to a
      // different network
      break;
    default:
      version = coerce(version);
  }
  return version;
}

function updatePkgJSONVersion(newVersion) {
  let version = nextVersion(newVersion);
  let pkgJSON = require(pkgJSONFile);
  pkgJSON.version = version;
  writeJSONSync(pkgJSONFile, pkgJSON, { spaces: 2 });
}

function updateCardpayProtocolVersion(newVersion) {
  let version = nextVersion(newVersion);
  let code = readFileSync(cardpayProtocolVersionFile, { encoding: "utf8" });
  code = code.replace(/return "\d\.\d\.\d";/, `return "${version}";`);
  writeFileSync(cardpayProtocolVersionFile, code);
}

module.exports = {
  nextVersion,
  updatePkgJSONVersion,
  updateCardpayProtocolVersion,
};
