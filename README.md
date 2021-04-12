![main status](https://github.com/cardstack/card-protocol-xdai/actions/workflows/main.yml/badge.svg)
# Card Protocol Contracts
The project hosts the contracts that comprise the Card Protocol. This includes the Prepaid Card Manager, Revenue Pool, SPEND token, and L2 Payment Token (e.g. DAI-CPXD).

## About the Card Protocol
TODO
### Prepaid Card Manager
TODO
### Revenue Pool
TODO
### L2 Payment Token
The layer 2 payment token is actually controlled by the token bridge. The token bridge will deploy upgradable ERC-677 compliant token contracts on an ad-hoc basis. This project supplies an ERC-677 token contract, but it is only meant for testing purposes and should not actually be deployed.

### SPEND Token
TODO

### Bridge Utils
TODO

## Prerequisites
The following prerequisites are required for this project:
- NodeJS ver 14+
- Yarn

## Building
To build this project execute:
```
yarn install
```


## Testing
To run all the tests execute:
```sh
yarn test
```

The tests include a gas report which provides the min, max, and avg gas consumed for all the public functions in the contract based on the gas consumed while running tests, as well as, the gas required to deploy the contracts.

To generate the test coverage report execute:
```sh
yarn test:coverage
```

## Deployment
We use a mnemonic held in AWS Secret Manager to manage our contract's key pair. You can use the online mnemonic tool to determine the address and private key based on the given mnemonic. https://iancoleman.io/bip39/

1. **Select a Mnemonic (or use an existing mnemonic)**

    Enter the mnemonic phrase (or generate a new 12 word phrase if the contract has not yet been deployed), and select "Coin" of `Ethereum` in the top Mnemonic panel, then select the `BIP44` tab in the Derivation Path panel. The address and private key for this mnemonic will be the first row that appears in the Derived Address panel at the bottom of the page.

2. **Fund the Wallet**

   Using the mnemonic tool above, determine the address for the wallet that is doing the deployment, and fund that wallet with enough native tokens (xDai tokens for the xDai network and SPOA for the Sokol network). There are faucets available here:

   - xDai Faucet: https://blockscout.com/xdai/mainnet/faucet
   - Sokol Faucet: https://blockscout.com/poa/sokol/faucet

3. **Deploy Contract (first time deploy)**

    **Staging:**
    For a staging deploy, deploy to the Sokol network by entering the following command:
    ```sh
    MNEMONIC=$(AWS_PROFILE=cardstack aws secretsmanager get-secret-value --secret-id=staging_card_protocol_mnemonic --region=us-east-1 | jq -r '.SecretString') yarn deploy:sokol
    ```
    (where the `AWS_PROFILE` env variable is the name of your profile that holds your cardstack staging environment credentials)

    **Production:**
    For a production deploy, deploy to the xDai network by entering the following command:
    ```sh
    MNEMONIC=$(AWS_PROFILE=cardstack-prod aws secretsmanager get-secret-value --secret-id=production_card_protocol_mnemonic --region=ap-southeast-1 | jq -r '.SecretString') yarn deploy:xdai
    ```
    (where the `AWS_PROFILE` env variable is the name of your profile that holds your cardstack production environment credentials)

    **Optional Configuration**

    As part of the contract deployment you may also provide the following environment variables to optionally configure the Card Protocol:
    - `GNOSIS_SAFE_MASTER_COPY` This defaults to the v1.2.0 version of the Gnosis safe master copy address: `0x6851d6fdfafd08c0295c392436245e5bc78b0185`
    - `GNOSIS_SAFE_FACTORY` This defaults to the v1.1.1 version of the Gnosis safe factory address: `0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B`
    - `TALLY` The address of the Tally contract which is responsible for withdrawing L2 tokens from the revenue pool on behalf of merchants when they wish to redeem their SPEND.
    - `BRIDGE_MEDIATOR` This is the address of the layer 2 token bridge contract. This defaults to a zero address.
    - `MINIMUM_AMOUNT` This is the minimum face value that a new prepaid card can be created with in units of SPEND. This defaults to 100 SPEND.
    - `MAXIMUM_AMOUNT` This is the maximum face value that a new prepaid card can be created with in units of SPEND. This defaults to 10,000,000 SPEND.

    The contract addresses that are created are saved in a `addresses-{network}.json` file.

    As of 4/1/2021 the total native network cost to deploy is 0.1934 units (SPOA in sokol), where the block gas limit is 12499976.

4. **Configure BridgeUtils**
   If the `BRIDGE_MEDIATOR` environment variable was not supplied (because the layer 2 token bridge contracts have not yet been deployed), then deploy the layer 2 token bridge contracts, and then configure the BridgeUtils contract with the address of the layer 2 token bridge contract. [Instructions to perform this are here.](./OPERATIONS.md#bridge-utils)

5. **Memorialize Contract State**
   OpenZeppelin captures state information about the contracts that have been deployed. It uses this information to determine whether its safe to upgrade future versions of the contract based on changes that have been made as well where to update the contracts. It is OpenZeppelin's strong recommendation that this contract state be under source control. This means that after the initial deploy and after subsequent contract upgrades we need to commit and merge changes to the `./.openzeppelin` folder. So make sure to `git commit` after any contract deploys and upgrades, as well as a `git push` to merge the commits back into the main branch so our representation of the state remains consistent.

## Upgrading Contracts
We use the Open Zeppelin SDK to manage our upgradable contracts. Once a contract has been deployed we have the ability to change the logic in the contract while still retaining the contract state due to the way in which Open Zeppelin maintains proxy contracts and their corresponding implementations. [There are a few limitations to be made aware of when updating a contract, which is outlined in the OZ documentation.](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#modifying-your-contracts). The OZ tools will check for any violations to the limitations as part of upgrading the contract and let you know if your changes to the contract are indeed upgradable changes. After you have made changes to the contract that you wish upgrade perform the following:
1. `git pull` (or `fetch` and `merge` if you prefer) the latest from the `main` git branch.
2. `git commit` your contract update changes (if they have not been committed already)
3. Run the open zeppelin contract upgrade command using our mnemonic from AWS:
   ```sh
   MNEMONIC=$(AWS_PROFILE=cardstack-prod aws secretsmanager get-secret-value --secret-id=production_card_protocol_mnemonic --region=ap-southeast-1 | jq -r '.SecretString') oz upgrade <contract name> --network <network>
   ```
   And then answer the questions from the interactive prompt regarding whether you need to execute a function as part of upgrading your contract.
4. Re-verify your contract source files in blockscout:
   ```sh
   ./verify.sh -c <contract name> -n <network>
   ```
   Note that I've seen blockscout be a bit squirrely about verifying contracts--sometimes it returns with a 504 error. One thing that I've seen that seems to help if to redeploy the implementation contract to a new address and reverify. It seems that if you get a 504 on a particular contract address, it will never verify at that address for some reason, but that the exact same contract code can be re-verified at a different address.
5. `git commit` the changes made to `./.openzeppelin`, as well as `git push` to merge the commits back into the main branch. These changes reflect the new contract upgrade state, and its very important that this state is shared with the team so it can remain consistent with the organization.

##
