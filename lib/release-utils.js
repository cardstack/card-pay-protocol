const inc = require("semver/functions/inc");
const coerce = require("semver/functions/coerce");
const { writeJSONSync } = require("fs-extra");
const { join } = require("path");

const pkgJSONFile = join(__dirname, "..", "package.json");

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

module.exports = {
  nextVersion,
  updatePkgJSONVersion,
};
