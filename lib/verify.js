const { merge } = require("sol-merger");
const { plugins } = require("sol-merger/dist/lib/plugins");
const retry = require("async-await-retry");
const { readFileSync } = require("fs");
const { dirname, join } = require("path");
const hre = require("hardhat");
const glob = require("glob");

async function verifyImpl(contractName, address) {
  const {
    network: {
      name: network,
    },
    config: {
      paths: { artifacts: artifactsPath },
      solidity: { compilers }
    }
  } = hre;

  console.log(
    `Attempting to verify ${contractName} on ${network} at address ${address}`
  );

  let apiUrl = {
    sokol: "https://blockscout.com/poa/sokol/api",
    xdai: "https://blockscout.com/poa/xdai/api"
   }[network]

  let contracts = glob.sync(`${hre.config.paths.sources}/**/${contractName}.sol`);
  if (contracts.length !== 1) {
    let msg = `Ambigous contract ${contractName}`;
    console.log(msg, contracts);
    throw new Error(msg);
  }
  let [sourcePath] = contracts;
  let relativePath = sourcePath.replace(hre.config.paths.sources + "/", "");

  let artifactPath = `${artifactsPath}/contracts/${relativePath}/${contractName}.dbg.json`;

  let { buildInfo } = JSON.parse(readFileSync(artifactPath));


  let buildInfoPath = join(dirname(artifactPath), buildInfo);
  let { solcVersion, solcLongVersion: compilerVersion } = JSON.parse(
    readFileSync(buildInfoPath)
  );

  let {
    settings: {
      evmVersion,
      optimizer: {
        enabled: optimizationUsed,
        runs: optimizerRuns
      }
    }
  } = compilers.find(c => c.version === solcVersion);

  let config = {
    address,
    apiUrl,
    compilerVersion,
    contractName,
    sourcePath,
    optimizationUsed,
    optimizerRuns,
    evmVersion
  };

  await verifier(config);

}

async function verifier({
  address,
  apiUrl,
  compilerVersion,
  contractName,
  sourcePath,
  optimizationUsed,
  optimizerRuns,
  evmVersion
}) {
  console.log("Attempting to verify contract at", address, "on blockscout");

  const params = {
    address,
    contractName,
    compiler: `v${compilerVersion.replace(".Emscripten.clang", "")}`,
    optimizationUsed,
    runs: optimizerRuns,
    evmVersion,
    apiUrl
  };

  try {
    await retry(
      async () => {
        const verified = await verifyContract(sourcePath, params);
        if (!verified) {
          let err = "Failed verification, retrying";
          console.log(err);
          throw new Error(err);
        }
      }
    );
  } catch (e) {
    console.log(`It was not possible to verify ${address} on blockscount`);
  }
}

async function isVerifiedBlockscout({ address, apiUrl }) {
  try {
    const {
      data: { result }
    } = await axios.get(
      `${apiUrl}?module=contract&action=getsourcecode&address=${address}&ignoreProxy=1`
    );
    return result && result.length && result[0].SourceCode;
  } catch (e) {
    return false;
  }
}

async function fetchMergedSource(sourcePath) {
  console.log(`Flattening source file ${sourcePath}`);

  // If a license is provided, we remove all other SPDX-License-Identifiers
  let mergedSource = await merge(sourcePath, {
    removeComments: false,
    exportPlugins: [plugins.SPDXLicenseRemovePlugin]
  });

  mergedSource = `// SPDX-License-Identifier: MIT\n\n${mergedSource}`;

  return mergedSource;
}

async function verifyContract(sourcePath, params) {
  try {
    let result;
    if (await isVerifiedBlockscout(params)) {
      console.log(`${params.address} is already verified on blockscout`);
      return true;
    }
    result = await sendVerifyRequestBlockscout(sourcePath, params);

    if (result.data.message === REQUEST_STATUS.OK) {
      console.log(`${params.address} verified on blockscout`);
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

const sendVerifyRequestBlockscout = async (contractPath, options) => {
  const contract = await fetchMergedSource(contractPath);
  const postQueries = {
    module: "contract",
    action: "verify",
    addressHash: options.address,
    contractSourceCode: contract,
    name: options.contractName,
    compilerVersion: options.compiler,
    optimization: options.optimizationUsed,
    optimizationRuns: options.runs,
    constructorArguments: options.constructorArguments,
    evmVersion: options.evmVersion
  };

  return sendRequest(options.apiUrl, postQueries);
};

const axios = require("axios");
const querystring = require("querystring");

const REQUEST_STATUS = {
  OK: "OK"
};

const sendRequest = (url, queries) => {
  console.log("Posting to", url);

  return axios.post(url, querystring.stringify(queries));
};

module.exports = { verifyImpl };
