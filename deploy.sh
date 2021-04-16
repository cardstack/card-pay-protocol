#!/bin/bash
set -e
set -x
######### contracts to be deployed #########
##
## Provide a list of each contract name (as specified
## in the sol file) to be deployed. If you want to
##  deploy multiple instances of the same contract, then
## provide an ID for the contract instance using ":"
## as a delimiter
CONTRACTS=(
  "PrepaidCardManager"
  "RevenuePool"
  "BridgeUtils"
  "SPEND",
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
  'ManualFeed:CARDFeed.setup CARD.CPXD/USD,8'
  'ManualFeed:CARDFeed.addRound  907143,1618433281,1618433281'
  'ManualFeed:DAIFeed.setup DAI.CPXD/USD,8'
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
ZERO_ADDRESS="0x0000000000000000000000000000000000000000"
TALLY=${TALLY:-${ZERO_ADDRESS}}
GNOSIS_SAFE_MASTER_COPY=${GNOSIS_SAFE_MASTER_COPY:-"0x6851d6fdfafd08c0295c392436245e5bc78b0185"}
GNOSIS_SAFE_FACTORY=${GNOSIS_SAFE_FACTORY:-"0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B"}
BRIDGE_MEDIATOR=${BRIDGE_MEDIATOR:-${ZERO_ADDRESS}}
MINIMUM_AMOUNT=${MINIMUM_AMOUNT:-100}      # minimum face value (in SPEND) for new prepaid card
MAXIMUM_AMOUNT=${MAXIMUM_AMOUNT:-10000000} # maximum face value (in SPEND) for new prepaid card
######################################################

cd "$(dirname $0)"
source "./lib/deploy-utils.sh"

usage() {
  echo "Usage: ./deploy.sh -n <network> [-s: skip blockscout verification]
Install Card Protocol contracts into Layer 2 network. This is used for first time
contract deployment. If you wish to upgrade a contract, then run 'oz upgrade'.
Additionally, you must set the environment variable 'MNEMONIC' to the mnemonic
for the deployer account.

-h   Display Help

-n   The network to deploy contracts to (xdai or sokol)

-s   [Optional] Skips the blockscout contract source verification
"
}

if [ -z "$MNEMONIC" ]; then
  echo "The MNEMONIC environment variable must be set to the mnemonic for the deployer"
  usage
  exit 1
fi

while getopts "hn:s" options; do
  case "$options" in
  h)
    usage
    exit 0
    ;;
  n)
    NETWORK=$OPTARG
    if [ "$NETWORK" != "sokol" -a "$NETWORK" != "xdai" ]; then
      echo "Must provide valid network to deploy to: 'sokol' or 'xdai'"
      usage
      exit 1
    fi
    ;;
  s)
    skipVerification="true"
    ;;
  *)
    echo "Unexpected option: $1"
    usage
    exit 1
    ;;
  esac
done

if [ -z "$NETWORK" ]; then
  echo "No network provided."
  usage
  exit 1
fi

commands="${network}_COMMANDS"
if [ -z "${!commands}" ]; then
  echo "Missing ${network}_COMMANDS for the configuration txns necessary for the contracts deployed in the network ${NETWORK}"
  exit 1
fi

deployerAddress="$(defaultAccount $NETWORK)"
echo "Deploying to $NETWORK with deployer address ${deployerAddress}"

# full compile with all downstream oz commands will utilize
yarn build:clean
echo ""

for contractInfo in "${CONTRACTS[@]}"; do
  contractParts=(${contractInfo//:/ })
  contractName=${contractParts[0]}
  id=${contractParts[1]:-${contractParts[0]}}
  instanceAddress=$(getLatestProxyAddress $NETWORK $contractName)
  if [ -n "$instanceAddress" ] && [ "$contractName" == "$id" ]; then
    echo "The contract $id has already been deployed. Use 'zos upgrade' to update it."
    declare "${id}_ADDRESS=${instanceAddress}"
    declare "${id}_INSTALLED=true"
  elif [ -n "$instanceAddress" ] && [ "$contractName" != "$id" ]; then
    read -p "An instance of the ${contractName} has already been deployed to ${instanceAddress}. Do you wish to deploy a new instance of this contract for ${id}? [y/N]" -n 1 -r
    if [ "$REPLY" != 'y' -a "$REPLY" != 'Y' ]; then
      declare "${id}_ADDRESS=${instanceAddress}"
      declare "${id}_INSTALLED=true"
      echo "If you wish to update $id. Use 'zos upgrade' to update it."
    fi
  fi

  installed="${id}_INSTALLED"
  if [ -z "${!installed}" ]; then
    initArgsName="${id}_INIT"
    initArgs=$(eval $(p ${!initArgsName}))

    echo "Deploying contract $contractName with args: ${initArgs}"
    instanceAddress=$(deploy $NETWORK $contractName "${initArgs}")
    if [ -z "${instanceAddress}" ]; then
      echo "Failed to deploy contract $contractName with args: ${initArgs}"
      exit 1
    fi
    declare "${id}_ADDRESS=${instanceAddress}"

    implementationAddress=$(getImplementationAddress $NETWORK $contractName $instanceAddress)
    echo "Deployed contract to $instanceAddress"
    verifyProxy $NETWORK $instanceAddress
    if [ -z "$skipVerification" ]; then
      verifyImplementation $NETWORK $contractName $implementationAddress
    fi
  fi
  echo ""
done

for command in "${!commands[@]}"; do
  action=${command%% *}
  contractIdPair=${action%%\.*}
  contract=${contractIdPair%%\:*}
  id="${contractIdPair:${#contract}+1}"
  id=${id:-${contract}}
  installed="${id}_INSTALLED"
  method=${action:${#contractIdPair}+1}
  args=$(p ${command:${#action}+1})
  toAddress="${id}_ADDRESS"
  to=${!toAddress}
  evalArgs=$(eval ${args})
  echo "Sending transaction: ${action}($evalArgs)"
  sendTxn $NETWORK $to $method "$evalArgs"
done

echo ""
addressesJSON=""
separator=""
for contractInfo in "${CONTRACTS[@]}"; do
  contractParts=(${contractInfo//:/ })
  contractName=${contractParts[0]}
  id=${contractParts[1]:-${contractParts[0]}}
  proxyAddress="${id}_ADDRESS"
  implementationAddress=$(getImplementationAddress $NETWORK $contractName ${!proxyAddress})
  addressesJSON="${addressesJSON}${separator}\"${id}\": { \"contractName\": \"${contractName}\", \"proxy\": \"${!proxyAddress}\", \"implementation\": \"${implementationAddress}\" }"
  separator=", "
  installed="${id}_INSTALLED"
  if [ -z "${!installed}" ]; then
    contractAddress="${id}_ADDRESS"
    echo "Created contract ${id}: ${!contractAddress} (proxy address)"
  fi
done
echo "{ ${addressesJSON} } " >./.openzeppelin/addresses-${NETWORK}.json

echo ""
echo "Deployment complete."
