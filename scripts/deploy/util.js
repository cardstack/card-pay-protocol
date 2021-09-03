const TrezorWalletProvider = require("trezor-cli-wallet-provider");

const hre = require("hardhat");
const { ethers } = hre;
const networks = require("@ethersproject/networks/lib/index.js");

function patchNetworks() {
  let oldGetNetwork = networks.getNetwork;

  networks.getNetwork = function (network) {
    if (network === "sokol" || network === 77) {
      return { name: "sokol", chainId: 77 };
    } else {
      return oldGetNetwork(network);
    }
  };
}

async function makeFactory(contractName) {
  if (hre.network.name === "hardhat") {
    return await ethers.getContractFactory(contractName);
  }
  return (await ethers.getContractFactory(contractName)).connect(getSigner());
}

function getSigner() {
  const {
    network: {
      name: network,
      config: { chainId, url: rpcUrl, derivationPath },
    },
  } = hre;

  const walletProvider = new TrezorWalletProvider(rpcUrl, {
    chainId: chainId,
    numberOfAccounts: 3,
    derivationPath,
  });

  const ethersProvider = new ethers.providers.Web3Provider(
    walletProvider,
    network
  );
  return ethersProvider.getSigner();
}

async function getDeployAddress() {
  if (hre.network.name === "hardhat") {
    let [signer] = await ethers.getSigners();
    return signer.address;
  }
  const trezorSigner = getSigner();
  return await trezorSigner.getAddress();
}

function asyncMain(main) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

async function retry(cb, maxAttempts = 5) {
  let attempts = 0;
  do {
    try {
      attempts++;
      return await cb();
    } catch (e) {
      console.log(
        `received ${e.message}, trying again (${attempts} of ${maxAttempts} attempts)`
      );
    }
  } while (attempts > maxAttempts);

  throw new Error("Reached max retry attempts");
}

module.exports = {
  makeFactory,
  getSigner,
  getDeployAddress,
  patchNetworks,
  asyncMain,
  retry,
};
