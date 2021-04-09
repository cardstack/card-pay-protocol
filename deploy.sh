#!/bin/bash
set -e
set -x

NETWORK=$1
SKIP_VERIFICATION=$2
cd "$(dirname $0)"
source "./lib/deploy-utils.sh"

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
  "SPEND"
)
######################################################

######## contract init arguments #######
##
## Provide a list of initialization arguments for each
## contract using the contract's name (or ID) followed
## by the suffix "_INIT". Variables are permitted to
## be used, but you must use 's to prevent them from
## being immeidately evaluated. The special $(p ...)
## wrapping allows us to late bind the variables.
PrepaidCardManager_INIT=$(p '${account}')
RevenuePool_INIT=$(p '${account}')
BridgeUtils_INIT=$(p '${account}')
SPEND_INIT=$(p "'SPEND-Token'" SPEND '${account}' '${RevenuePool_ADDRESS}')
######################################################

######### contract configuration #####################
##
COMMANDS=(
  'RevenuePool.setup ${TALLY} ${GNOSIS_SAFE_MASTER_COPY} ${GNOSIS_SAFE_FACTORY} ${SPEND_ADDRESS} []'
  'PrepaidCardManager.setup ${TALLY} ${GNOSIS_SAFE_MASTER_COPY} ${GNOSIS_SAFE_FACTORY} ${RevenuePool_ADDRESS} [] ${MINIMUM_AMOUNT} ${MAXIMUM_AMOUNT}'
  'BridgeUtils.setup ${RevenuePool_ADDRESS} ${PrepaidCardManager_ADDRESS} ${GNOSIS_SAFE_MASTER_COPY} ${GNOSIS_SAFE_FACTORY} ${BRIDGE_MEDIATOR}'
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

read -p "This script will deploy a branch new instance of the Card Protocol to the ${NETWORK}. If you wish to upgrade a contract, please use the 'oz upgrade' command. Do you wish to continue? [y/N] " -n 1 -r
if [ "$REPLY" != 'y' -a "$REPLY" != 'Y' ]; then
  exit 0
fi

if [ "$NETWORK" != "sokol" -a "$NETWORK" != "xdai" ]; then
  echo "Must provide valid network to deploy to: 'sokol' or 'xdai'"
  exit 1
fi

if [ -z "$MNEMONIC" ]; then
  echo "The MNEMONIC environment variable must be set to the mnemonic for the deployer"
  exit 1
fi

account="$(defaultAccount $NETWORK)"

echo "Deploying to $NETWORK with deployer address ${account}"

# full compile with all downstream oz commands will utilize
yarn build:clean

for contractInfo in "${CONTRACTS[@]}"; do
  contractParts=(${contractInfo//:/ })
  contractName=${contractParts[0]}
  id=${contractParts[1]:-${contractParts[0]}}
  initArgsName="${id}_INIT"
  initArgs=$(eval ${!initArgsName})
  initArgs="${initArgs//\'/\"}"

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
  if [ "$SKIP_VERIFICATION" != "--skip-verification" ]; then
    verifyImplementation $NETWORK $contractName $implementationAddress
  fi
done

echo "Deployment complete."
