# Docker Config for Local Blockchain Node

Cardpay smart contracts depend on other smart contracts such as token bridge, gnosis safe, XDAI, and CPXD. Therefore to run the cardpay smart contract locally, we need to have a local blockchain node that has included those required smart contracts. The zip files in this directory, `foreign-node.zip` and `home-node.zip`, are the snapshot of the ganache database, which are the blocks that include the required smart contracts.

You can follow these steps if you need to update the zip files.

1. Run `foreign-node` and `home-node` container, please follow [this](../README.md#deploying-to-local-computer-network). Make sure the container status is healty before continue to the next step.
2. Deploy the smart contract or execute the changes.
3. `cd docker` please make sure your terminal in `docker` directory.
4. Execute `capture-blocknode.sh` file. Example: `sh capture-blocknode.sh`