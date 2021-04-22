#!/bin/bash
set -e

######### contracts to be deployed #########
##
## Provide a list of each contract name (as specified
## in the sol file) to be deployed. If you want to
##  deploy multiple instances of the same contract, then
## provide an ID for the contract instance using ":"
## as a delimiter
contracts=(
  "PrepaidCardManager"
  "RevenuePool"
  "BridgeUtils"
  "SPEND"
  "ManualFeed:DAIFeed"
  "ManualFeed:CARDFeed"
)
## Note that after the contract is deployed, the proxy
## instance address for the contract will be set in
## the variable:
##    ContractName_ADDRESS
## You can use this variable as an init argument in
## a subsequent contract deployment or contract
## method invocation.
######################################################

######## contract init arguments #######
##
## Provide a list of initialization arguments for each
## contract using the contract's name (or ID) followed
## by the suffix "_INIT". Variables are permitted to
## be used and will be late bound. Mulitple arguments
## must be delimited with a space character
PrepaidCardManager_INIT='${deployerAddress}'
RevenuePool_INIT='${deployerAddress}'
BridgeUtils_INIT='${deployerAddress}'
SPEND_INIT='${deployerAddress} ${RevenuePool_ADDRESS}'
DAIFeed_INIT='${deployerAddress}'
CARDFeed_INIT='${deployerAddress}'
######################################################

######### contract configuration #####################
##
## Provide a list of transactions to configure the
## card protocol after the deployment of branch new
## contracts. Each transaction should be in the format
## of:
##   ContractName.method arg1,arg2,arg3
## Variables are permitted to be used and late bound.
## Note that unlike the init args, multiple args must
## be delimited by commas (thanks oz)
sokol_COMMANDS=(
  'ManualFeed:CARDFeed.setup CARD_USD,8'
  'ManualFeed:CARDFeed.addRound  907143,1618433281,1618433281'
  'ManualFeed:DAIFeed.setup DAI_USD,8'
  'ManualFeed:DAIFeed.addRound  100085090,1618433281,1618433281'
  'RevenuePool.setup ${TALLY},${GNOSIS_SAFE_MASTER_COPY},${GNOSIS_SAFE_FACTORY},${SPEND_ADDRESS},[]'
  'RevenuePool.createExchange DAI,${DAIFeed_ADDRESS}'
  'RevenuePool.createExchange CARD,${CARDFeed_ADDRESS}'
  'PrepaidCardManager.setup ${TALLY},${GNOSIS_SAFE_MASTER_COPY},${GNOSIS_SAFE_FACTORY},${RevenuePool_ADDRESS},[],${MINIMUM_AMOUNT},${MAXIMUM_AMOUNT}'
  'PrepaidCardManager.setBridgeUtils ${BridgeUtils_ADDRESS}'
  'RevenuePool.setBridgeUtils ${BridgeUtils_ADDRESS}'
  'BridgeUtils.setup ${RevenuePool_ADDRESS},${PrepaidCardManager_ADDRESS},${GNOSIS_SAFE_MASTER_COPY},${GNOSIS_SAFE_FACTORY},${BRIDGE_MEDIATOR}'
)
######################################################

######## initialize defaults #########################
##
zero_address="0x0000000000000000000000000000000000000000"
TALLY=${TALLY:-${zero_address}}
GNOSIS_SAFE_MASTER_COPY=${GNOSIS_SAFE_MASTER_COPY:-"0x6851d6fdfafd08c0295c392436245e5bc78b0185"}
GNOSIS_SAFE_FACTORY=${GNOSIS_SAFE_FACTORY:-"0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B"}
BRIDGE_MEDIATOR=${BRIDGE_MEDIATOR:-${zero_address}}
MINIMUM_AMOUNT=${MINIMUM_AMOUNT:-100}      # minimum face value (in SPEND) for new prepaid card
MAXIMUM_AMOUNT=${MAXIMUM_AMOUNT:-10000000} # maximum face value (in SPEND) for new prepaid card
######################################################

serializeAddresses() {
  addressesJSON=""
  separator=""
  for _contractInfo in "${contracts[@]}"; do
    _contractParts=(${_contractInfo//:/ })
    _contractName=${_contractParts[0]}
    _id=${_contractParts[1]:-${_contractParts[0]}}
    _proxyAddress="${_id}_ADDRESS"
    _implementationAddress=$(getImplementationAddress $network $_contractName ${!_proxyAddress})
    if [ -n "${!_proxyAddress}" ] && [ -n "${_implementationAddress}" ]; then
      addressesJSON="${addressesJSON}${separator}\"${_id}\": { \"contractName\": \"${_contractName}\", \"proxy\": \"${!_proxyAddress}\", \"implementation\": \"${_implementationAddress}\" }"
      separator=", "
    fi
  done
  echo "{ ${addressesJSON} } " >./.openzeppelin/addresses-${network}.json
}

cd "$(dirname $0)"
source "./lib/deploy-utils.sh"
check_semver="./lib/check_semver.sh"

usage() {
  echo "Usage: ./deploy.sh -n <network> [-s: skip blockscout verification]
Install Card Protocol contracts into Layer 2 network. This is used for first time
contract deployment. If you wish to upgrade a contract, then run 'oz upgrade'.
Additionally, you must set the environment variable 'MNEMONIC' to the mnemonic
for the deployer account.

-h   Display Help

-n   The network to deploy contracts to (xdai or sokol)

-s   [Optional] Skips the blockscout contract source verification

-v   [Optional] Specify a version which is memorialized as a tag in git and in the package.json
"
}

if [ -z "$MNEMONIC" ]; then
  echo "The MNEMONIC environment variable must be set to the mnemonic for the deployer"
  usage
  exit 1
fi

while getopts "hn:sv:" options; do
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
  s)
    skipVerification="true"
    ;;
  v)
    version="$($check_semver -v $OPTARG || echo "'${OPTARG}' is not a valid semantic version")"
    if [ "$version" != "$OPTARG" ]; then
      echo "${version}"
      exit 1
    elif [ "$version" == "$(jq -r .version ./package.json)" ]; then
      echo "The version '${version}' is already being used"
      exit 1
    fi
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

networkCommands="${network}_COMMANDS"
if [ -z "${!networkCommands}" ]; then
  echo "Missing ${network}_COMMANDS for the configuration txns necessary for the contracts deployed in the network ${network}"
  exit 1
fi

deployerAddress="$(defaultAccount $network)"
echo "Deploying to $network with deployer address ${deployerAddress}"

# full compile with all downstream oz commands will utilize
yarn build:clean
echo ""

for contractInfo in "${contracts[@]}"; do
  contractParts=(${contractInfo//:/ })
  contractName=${contractParts[0]}
  id=${contractParts[1]:-${contractParts[0]}}
  instanceAddress=$(getLastDeployedProxyAddress $network $id)
  if [ -n "$instanceAddress" ]; then
    echo "The contract $id has already been deployed. Use 'zos upgrade' to update it."
    declare "${id}_ADDRESS=${instanceAddress}"
    declare "${id}_INSTALLED=true"
  fi

  installed="${id}_INSTALLED"
  if [ -z "${!installed}" ]; then
    initArgsName="${id}_INIT"
    initArgs=$(eval $(p ${!initArgsName}))

    echo "Deploying contract $id as $contractName with args: ${initArgs}"

    if [ -z "$skipVerification" ]; then
      instanceAddress=$(deployWithVerification $network $contractName "${initArgs}")
    else
      instanceAddress=$(deploy $network $contractName "${initArgs}")
    fi

    if [ -z "$instanceAddress" ] || [[ ! "$instanceAddress" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
      instanceAddress=${instanceAddress:-"Failed to deploy contract $contractName with args: ${initArgs}"}
      exit 1
    fi
    declare "${id}_ADDRESS=${instanceAddress}"
    echo "Deployed contract to $instanceAddress"
  fi
  echo ""
done
serializeAddresses

if [ $network == "sokol" ]; then
  for command in "${sokol_COMMANDS[@]}"; do
    execCommand $network "$command"
  done
elif [ $network == "xdai" ]; then
  for command in "${xdai_COMMANDS[@]}"; do
    execCommand $network "$command"
  done
fi

echo ""
for contractInfo in "${contracts[@]}"; do
  contractParts=(${contractInfo//:/ })
  contractName=${contractParts[0]}
  id=${contractParts[1]:-${contractParts[0]}}
  proxyAddress="${id}_ADDRESS"
  installed="${id}_INSTALLED"
  if [ -z "${!installed}" ]; then
    contractAddress="${id}_ADDRESS"
    echo "Created contract ${id}: ${!contractAddress} (proxy address)"
  fi
done

if [ -n "$version" ]; then
  for contractInfo in "${contracts[@]}"; do
    contractParts=(${contractInfo//:/ })
    contractName=${contractParts[0]}
    id=${contractParts[1]:-${contractParts[0]}}
    proxyAddress="${id}_ADDRESS"
    tagMessage="$tagMessage
${id} address: ${!proxyAddress}"
  done
  echo "$(cat ./package.json | jq ".version = \"${version}\"")" >./package.json
  git commit -am "ver ${version}" ./package.json ./openzeppelin
  git tag -a "$version" -m "$tagMessage"
  echo "git tag '${version}' created
use 'git push $(basename $(git rev-parse --show-toplevel)) ${version}' to push the tag to the remote repo"
fi

echo ""
echo "Deployment complete."
