const {
  config: { networks },
} = require("hardhat");

const ethersNetworks = require("@ethersproject/networks");

function patchNetworks() {
  let oldGetNetwork = networks.getNetwork;

  networks.getNetwork = function (network) {
    if (network === "sokol" || network === 77) {
      return { name: "sokol", chainId: 77 };
    } else {
      return oldGetNetwork(network);
    }
  };
  oldGetNetwork = ethersNetworks.getNetwork;

  ethersNetworks.getNetwork = function (network) {
    if (network === "sokol" || network === 77) {
      return {
        name: "sokol",
        chainId: 77,
        ensAddress: undefined,
        _defaultProvider: null,
      };
    } else {
      return oldGetNetwork(network);
    }
  };
}

module.exports = { patchNetworks };
