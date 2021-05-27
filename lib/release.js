const { execSync } = require("child_process");
const { updatePkgJSONVersion, nextVersion } = require("./release-utils");
const mapValues = require("lodash/mapValues");
const { join } = require("path");

const [network, nextVer = "patch"] = process.argv.slice(2);
const addressesFile = join(
  __dirname,
  "..",
  ".openzeppelin",
  `addresses-${network}.json`
);

let version = nextVersion(nextVer);
console.log(`setting package.json version to ${version}`);
updatePkgJSONVersion(nextVer);

console.log(`tagging release v${version}, and pushing`);
let addresses = mapValues(require(addressesFile), ({ proxy }) => proxy);
let cwd = join(__dirname, "..");
let tagMessage = `Network: ${network}

${JSON.stringify(addresses, null, 2)}`;
execSync(
  `git add ./package.json ./.openzeppelin ./contracts/core/Versionable.sol`,
  { cwd }
);
execSync(`git commit -m "v${version}"`, { cwd });
execSync(`git tag -a "v${version}" -m "${tagMessage}"`, { cwd });
execSync(`git push origin "v${version}"`, { cwd });
