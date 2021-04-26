#!/bin/bash
set -e

cd "$(dirname $0)"
source "./lib/deploy-utils.sh"

usage() {
  echo "Usage: ./verify.sh -n <network> -c <[optional contract id]:><contract name> [-a <contract proxy address]

-h   Display Help

-n   The network to in which to verify the contracts (xdai or sokol)

-c   The contract name

-a   [Optional] The proxy address of the contract to verify. If this is
     not provided then we'll look it up from the .openzeppelin/ folder and use the
     latest one. This is useful in the situation where we are maintaining mulitple
     instances of the same contract--like a token contract for different tokens.
"
}

while getopts "hc:n:a:" options; do
  case "$options" in
  h)
    usage
    exit 0
    ;;
  n)
    network=$OPTARG
    if [ "$network" != "sokol" -a "$network" != "xdai" ]; then
      echo "Must provide valid network to deploy to: 'sokol' or 'xdai'"
      usage
      exit 1
    fi
    ;;
  c)
    contractParts=(${OPTARG//:/ })
    contractName=${contractParts[0]}
    id=${contractParts[1]:-${contractParts[0]}}
    ;;
  a)
    proxyAddress=$OPTARG
    ;;
  *)
    echo "Unexpected option: $1"
    usage
    exit 1
    ;;
  esac
done

if [ -z "$network" ]; then
  echo "No network provided."
  usage
  exit 1
fi
if [ -z "$id" ]; then
  echo "No contract name provided."
  usage
  exit 1
fi

if [ -z "$proxyAddress" ]; then
  proxyAddress=$(getLastDeployedProxyAddress $network $id)
fi
if [ -z "$proxyAddress" ]; then
  echo "Cannot find the proxy address for the contract: ${id}"
  exit 1
fi

implementationAddress=$(getImplementationAddress $network $contractName $proxyAddress)
echo "Verifying ${id} proxy ${proxyAddress}"
verifyProxy $network $instanceAddress
verifyImplementation $network $contractName $implementationAddress
