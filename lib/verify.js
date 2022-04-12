const hre = require("hardhat");
const axios = require("axios");

async function isVerifiedBlockscout(address) {
  let apiUrl = {
    sokol: "https://blockscout.com/poa/sokol/api",
    xdai: "https://blockscout.com/poa/xdai/api",
  }[hre.network.name];

  if (!apiUrl) {
    throw new Error(`Could not find api url for network ${hre.network.name}`);
  }

  try {
    let url = `${apiUrl}?module=contract&action=getsourcecode&address=${address}&ignoreProxy=1`;
    const {
      data: { result },
    } = await axios.get(url);
    return result && result.length && result[0].SourceCode;
  } catch (e) {
    console.log(e);
    return false;
  }
}
module.exports = { isVerifiedBlockscout };
