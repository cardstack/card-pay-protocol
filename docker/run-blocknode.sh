#!/bin/bash

node /app/ganache-core.docker.cli.js --deterministic --db=/ganache_data --defaultBalanceEther 10000 -m 'test test test test test test test test test test test junk' --noVMErrorsOnRPCResponse --gasLimit 10000000 --hostname 0.0.0.0 --networkId $NETWORK_ID --chainId $CHAIN_ID --debug
