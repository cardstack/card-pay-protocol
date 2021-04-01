# Card Protocol Contracts
The project hosts the contracts that comprise the Card Protocol. This includes the Prepaid Card Manager, Revenue Pool, SPEND token, and L2 Payment Token (e.g. DAI-CPXD).

## About the Card Protocol
TODO
### Prepaid Card Manager
TODO
### Revenue Pool
TODO
### L2 Payment Token
TODO
### SPEND Token
TODO

## Deployment
We use a mnemonic held in AWS Secret Manager to manage our contract's key pair. You can use the online mnemonic tool to determine the address and private key based on the given mnemonic. https://iancoleman.io/bip39/

1. **Select a Mnemonic (or use an existing mnemonic)**

    Enter the mnemonic phrase (or generate a new 12 word phrase if the contract has not yet been deployed), and select "Coin" of `Ethereum` in the top Mnemonic panel, then select the `BIP44` tab in the Derivation Path panel. The address and private key for this mnemonic will be the first row that appears in the Derived Address panel at the bottom of the page.

2. **Fund the Wallet**

   Using the mnemonic tool above, determine the address for the wallet that is doing the deployment, and fund that wallet with enough native tokens (xDai tokens for the xDai network and SPOA for the Sokol network). There are faucets available here:

   - xDai Faucet: https://blockscout.com/xdai/mainnet/faucet
   - Sokol Faucet: https://blockscout.com/poa/sokol/faucet

3. **Deploy Contract**

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
    - `MINIMUM_AMOUNT` This is the minimum face value that a new prepaid card can be created with in units of SPEND. This defaults to 100 SPEND.
    - `MAXIMUM_AMOUNT` This is the maximum face value that a new prepaid card can be created with in units of SPEND. This defaults to 10,000,000 SPEND.

    The contract addresses that are created are saved in a `addresses-{network}.json` file.

    As of 4/1/2021 the total native network cost to deploy is 0.1934 units (SPOA in sokol), where the block gas limit is 12499976.

4. **Verify Contracts**

   After the contracts have been deployed to the blockchain, we need to upload our verified source code to the L2 Block Explorer, BlockScout.

    **Staging**
    For the staging deployment run:
    ```
    yarn verify:sokol
    ```

    **Production**
    For the production deployment run:
    ```
    yarn verify:xdai
    ```
5. **Memorialize Contract Locations**

   The contract addresses are saved in a `addresses-{network}.json` file. In order to memorialize our current card protocol addresses, commit and push the new/updated `addresses-{network}.json` file`.
