const {
  updateCardpayProtocolVersion,
  nextVersion,
} = require("./release-utils");

const [nextVer = "patch"] = process.argv.slice(2);
console.log(`setting cardpay protocol version to ${nextVersion(nextVer)}`);
updateCardpayProtocolVersion(nextVer);
