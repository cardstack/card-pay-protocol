#!/bin/bash
set -e
set -x

NETWORK=$1
cd "$(dirname $0)"
source "./lib/deploy-utils.sh"

######### Configure contracts to be deployed #########
##
## Provide a list of each contract name (as specified
## in the sol file) to be deployed. If you want to
##  deploy multiple instances of the same contract, then
## provide an ID for the contract instance using ":"
## as a delimiter
CONTRACTS=(
  "ERC677Token:DAI"
  # "ERC677Token:CARD"
  # "PrepaidCardManager"
)
######################################################

######## Configure the contract init arguments #######
##
## Provide a list of initialization arguments for each
## contract using the contract's name (or ID) followed
## by the suffix "_INIT" and the suffix of the network
DAI_INIT_xdai=$(p "'DAICPXD-Token'" DAICPXD 18 '${account}')
DAI_INIT_sokol=$(p "'DAICPSK-Token'" DAICPSK 18 '${account}')
CARD_INIT_xdai=$(p "'CARDCPXD-Token'" CARDCPXD 18 '${account}')
CARD_INIT_sokol=$(p "'CARDCPSK-Token'" CARDCPSK 18 '${account}')
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

for contractInfo in "${CONTRACTS[@]}"; do
  contractParts=(${contractInfo//:/ })
  contractName=${contractParts[0]}
  id=${contractParts[1]:-${contractParts[0]}}
  initArgsName="${id}_INIT_${NETWORK}"
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
  verifyImplementation $NETWORK $contractName $implementationAddress
done
