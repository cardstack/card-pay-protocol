# Card Protocol Layer 2 Contracts

## Deployment
We use a mnemonic held in AWS Secret Manager to manage our contract's key pair. You can use the online mnemonic tool to determine the address and private key based on the given mnemonic. https://iancoleman.io/bip39/

1. **Select a Mnemonic (or use an existing mnemonic)**

    Enter the mnemonic phrase (or generate a new 12 word phrase if the contract has not yet been deployed), and select "Coin" of `Ethereum` in the top Mnemonic panel, then select the `BIP44` tab in the Derivation Path panel. The address and private key for this mnemonic will be the first row that appears in the Derived Address panel at the bottom of the page.

2. **Fund the Wallet**

   Using the mnemonic tool above, determine the address for the wallet that is doing the deployment, and fund that wallet with enough native tokens (xDai tokens for the xDai network and SPOA for the Sokol network). There are faucets available here:

   - xDai Faucet: https://blockscout.com/xdai/mainnet/faucet
   - Sokol Faucet: https://faucet.poa.network/

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

