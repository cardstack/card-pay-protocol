# Card Protocol Operations
This document describes various operations procedures for the on-going maintenance necessary for the Card Protocol, as well as procedures to aid in testing the Card Protocol. Many of these operations require "owner" access in order to execute. We'll use BlockScout and Metamask to perform these operations steps.

- [Card Protocol Operations](#card-protocol-operations)
  - [Configuring Metamask](#configuring-metamask)
    - [Adding Sokol Network](#adding-sokol-network)
    - [Adding xDai Network](#adding-xdai-network)
    - [Owner private key](#owner-private-key)
  - [L2 Tokens (DAI-CPXD, DAI-CPSK)](#l2-tokens-dai-cpxd-dai-cpsk)
    - [Add Minter](#add-minter)
    - [Renounce Minter](#renounce-minter)
    - [Minting L2 Tokens](#minting-l2-tokens)
  - [Prepaid Card Manager](#prepaid-card-manager)
    - [Setup](#setup)
    - [Add Payable Token](#add-payable-token)
    - [Remove Payable Token](#remove-payable-token)
    - [Update Minimum Amount](#update-minimum-amount)
    - [Update Maximum Amount](#update-maximum-amount)
  - [Revenue Pool](#revenue-pool)
    - [Setup](#setup-1)
    - [Add Payable Token](#add-payable-token-1)
    - [Remove Payable Token](#remove-payable-token-1)
    - [Add Tally](#add-tally)
    - [Remove Tally](#remove-tally)
    - [Register Merchant](#register-merchant)
  - [Relay](#relay)
    - [Setup Payer](#setup-payer)
  - [Token Bridge](#token-bridge)


## Configuring Metamask
In order to update contracts with the "owner" account, you will need to add the owner's wallet to your Metamask. Metamask does not come preconfigured with the xDai nor Sokol network, so you'll need to add it if you haven't already. Download and install the "Metamask" Chrome extension. Make sure to set a challenging password that you won't forget.

### Adding Sokol Network
1. Open Metamask and in the network drop down in the center select "Custom RPC"
2. In the Network name field enter: "POA Sokol Testnet"
3. In the New RPC URL field enter: https://sokol.poa.network
4. In the ChainID field enter: 77
5. In the Symbol field enter: SPOA
6. In the Block Explorer URL field enter: https://blockscout.com/poa/sokol

### Adding xDai Network
1. Open Metamask and in the network drop down in the center select "Custom RPC"
2. In the Network name field enter: xDai
3. In the New RPC URL field enter: https://rpc.xdaichain.com/
4. In the ChainID field enter: 100
5. In the Symbol field enter: xDai
6. In the Block Explorer URL field enter: https://blockscout.com/xdai/mainnet


### Owner private key
1. Login to AWS and go to the Secrets Manager. Locate the `{env}_card_protocol_mnemonic` secret and reveal the secret value.
2. In an incognito window go to the URL: https://iancoleman.io/bip39/
3. Air gap your computer: unplug *all* peripherals, *turn off* your WIFI. Make sure your computer screen is not visible to any other people or cameras.
4. Copy the mnemonic from the secrets manager into the BIP39 Mnemonic field.
5. Select "Coin" of "ETH Ethereum"
6. In the middle panel, select the "BIP44" Derivation Path tab.
7. The private key is in the first row of the Derived Addresses panel in the "private key" column
8. Open Metamask and enter your password.
9. In the network drop down (top center), select the network (either Sokol or xDai).
10. Click on the account icon (the top right icon)
11. Select "Create Account"
12. Click on the "Import" tab and copy/paste the private key into the "Private Key" field.
13. Click on the "Import Button", the imported wallet should contain some tokens.
14. To make life easier rename the created account to something like "{network name} Card Protocol Owner", where "{network name}" is Either "Sokol" or "xDai". You can do this by clicking on the "hamburger" icon and selecting the "Account Details" item. Click on the pencil icon next to the account name and rename it to something easier to remember.
15. Close the incognito window that has the private key.
16. You may now reconnect peripherals and turn your WIFI back on.

## L2 Tokens (DAI-CPXD, DAI-CPSK)
The Card Protocol makes use of our own set of layer 2 tokens which are used to purchase prepaid cards. At the time of this writing the layer 2 tokens supported are `DAI-CPXD` in xDai network and `DAI-CPSK` in the Sokol test network. More layer 2 tokens will likely be added in the future. When bridging layer 1 tokens to layer 2, our token bridge contract deposits the bridged layer 2 tokens in a gnosis safe called the "depot", which the user can then use to make gasless purchases of prepaid card. For testing purposes, though, it will be useful to mint the layer 2 tokens directly to an EOA for the purposes of testing.

### Add Minter
The owner of the L2 token contract is allowed to add addresses that are allowed to mint this token.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the L2 token contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the token contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "Add Minter" row and add the address of a new minter.
6. Click on the "Write" button of the "Add Minter" row.
7. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
8. After the transaction has completed, you can confirm the minter was added by clicking on the "Read Contract" tab and enter the newly added minter's address in the "isMinter" row, and clicking on the "Query" button.

### Renounce Minter
The owner of the L2 token contract is allowed to renounce addresses that are allowed to mint this token.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the L2 token contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the token contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "Renounce Minter" row and add the address of the minter to renounce.
6. Click on the "Write" button of the "Renounce Minter" row.
7. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
8. After the transaction has completed, you can confirm the minter was renounced by clicking on the "Read Contract" tab and enter the renounced minter's address in the "isMinter" row, and clicking on the "Query" button.

### Minting L2 Tokens
The owner of the L2 contract as well as any addresses that have been added as "minters" are allowed to mint this token.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the L2 token contract whose tokens you wish to mint (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the token contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner or approved minter address for the correct network in metamask
5. Locate the "Mint" row, it is most likely row 7.
6. In the "Mint" row, enter the address that will receive the L2 tokens
7. In the "Mint" row, enter the amount of tokens to min _in units of wei_. You can use this handy wei converter here https://eth-converter.com/. Enter the amount of tokens you with to transfer as units of "Ether", and the converter will display the corresponding amount in wei.
8. Click on the "Write" button in the "Mint" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the balance by clicking on the "Read Contract" tab and enter the recipient's address in the "balanceOf" row, and clicking on the "Query" button. The value displayed will be in units of wei. Feel free to use the converter to see the balance in units of "ether".

## Prepaid Card Manager
The Prepaid Card Manager is responsible for creating Prepaid Cards and cosigning transactions that originate from the prepaid card. This may include paying merchants, splitting prepaid cards, or transferring prepaid card ownership.

### Setup
The `setup` function of the prepaid card manager allows us to configure some basic aspects of how this contract functions including:
- setting an array of Tally contract addresses (these are addresses that are allowed to invoke the redeem SPEND function on the revenue pool contract)
- setting the Gnosis safe master copy address
- setting the Gnosis safe factory address
- setting the revenue pool contract address
- setting an array of L2 tokens that are accepted by the prepaid card manager
- setting the minimum face value of newly created prepaid cards (in units of SPEND tokens)
- setting the maximum face value of newly created prepaid cards (in units of SPEND tokens)

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the PrepaidCardManager. If you wish to retain the current value, then use the "Read Contract" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Contract" tab and reviewing all the fields that pertain to the setup parameters.

### Add Payable Token
The `addPayableToken` function allows the prepaid card manager to accept a new L2 token address to be used for creating a prepaid card.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "addPayableToken" row and enter the address for the L2 token that you wish to add as a payable token
6. Click on the "Write" button in the "addPayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was added by clicking on the "Read Contract" tab and looking at the "getTokens" row.

### Remove Payable Token
The `removePayableToken` function allows the prepaid card manager to no longer accept an L2 token address as a token that can be used to create a prepaid card.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "removePayableToken" row and enter the address for the L2 token that you wish to remove as a payable token
6. Click on the "Write" button in the "removePayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was removed by clicking on the "Read Contract" tab and looking at the "getTokens" row.

### Update Minimum Amount
The `updateMinimumAmount` function changes the minimum face value in units of SPEND tokens that a prepaid card is allowed to be created with.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "updateMinimumAmount" row and enter the minimum value in SPEND tokens (no wei conversion necessary) that a prepaid card can be created with.
6. Click on the "Write" button in the "updateMinimumAmount" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the minimum amount was set by clicking on the "Read Contract" tab and looking at "getMinimumAmount" amount value.

### Update Maximum Amount
The `updateMaximumAmount` function changes the maximum face value in units of SPEND tokens that a prepaid card is allowed to be created with.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "updateMaximumAmount" row and enter the maximum value in SPEND tokens (no wei conversion necessary) that a prepaid card can be created with.
6. Click on the "Write" button in the "updateMaximumAmount" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the maximum amount was set by clicking on the "Read Contract" tab and looking at "getMaximumAmount" amount value.

## Revenue Pool
The Revenue pool collects the L2 tokens used to pay merchants, and mints SPEND tokens that the merchants can redeem against the funds collected in the revenue pool.

### Setup
The `setup` function of the revenue pool allows us to configure some basic aspects of how this contract functions including:
- setting an array of Tally contract addresses (these are addresses that are allowed to invoke the redeem SPEND function on the revenue pool contract)
- setting the Gnosis safe master copy address
- setting the Gnosis safe factory address
- setting the SPEND token contract address
- setting an array of L2 tokens that are accepted by the revenue pool

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the RevenuePool. If you wish to retain the current value, then use the "Read Contract" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Contract" tab and reviewing all the fields that pertain to the setup parameters.

### Add Payable Token
The `addPayableToken` function allows the revenue pool to accept a new L2 token address to be used as payment to a merchant.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "addPayableToken" row and enter the address for the L2 token that you wish to add as a payable token
6. Click on the "Write" button in the "addPayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was added by clicking on the "Read Contract" tab and looking at the "getTokens" row.

### Remove Payable Token
The `removePayableToken` function allows the revenue pool to no longer accept an L2 token address to be used as payment to a merchant.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "removePayableToken" row and enter the address for the L2 token that you wish to remove as a payable token
6. Click on the "Write" button in the "removePayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was removed by clicking on the "Read Contract" tab and looking at the "getTokens" row.

### Add Tally
The `addTally` function adds an address that is permitted to call a function to redeem SPEND tokens on behalf of a merchant from the revenue pool.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "addTally" row and enter the address that is permitted to call the `claimToken()` function
6. Click on the "Write" button in the "addTally" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the tally address was added by clicking on the "Read Contract" tab and looking at the "getTallys" row.

### Remove Tally
The `removeTally` function removes an address that is permitted to call a function to redeem SPEND tokens on behalf of a merchant from the revenue pool.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "removeTally" row and enter the address that is no longer permitted to call the `claimToken()` function
6. Click on the "Write" button in the "removeTally" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the tally address was removed by clicking on the "Read Contract" tab and looking at the "getTallys" row.

### Register Merchant
The `registerMerchant` function adds the address of a merchant in the revenue pool that is permitted to accept payment with prepaid card as well as is able to redeem SPEND tokens from the revenue pool.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "registerMerchant" row and enter the merchant's address
6. Click on the "Write" button in the "registerMerchant" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the merchant was registered was added by setting the merchant's address in the isMerchant field and clicking on the "Query" button.

## Relay
The relay is a server that is responsible for relying gnosis transactions to the blockchain from a web service. A key feature of the relay is that it pays for the gas of the transactions that it relays to the blockchain.

### Setup Payer
In order to setup the relay, a gas payer must be designated for the relay. This is an EOA that is funded with a suitable amount of native network coins to handle paying for gas within the card protocol in L2.
1. Login to AWS and go to the Secrets Manager. Locate the `{env}_card_protocol_payer_mnemonic` secret and reveal the secret value.
2. In an incognito window go to the URL: https://iancoleman.io/bip39/
3. Air gap your computer: unplug *all* peripherals, *turn off* your WIFI. Make sure your computer screen is not visible to any other people or cameras.
4. Copy the mnemonic from the secrets manager into the BIP39 Mnemonic field.
5. Select "Coin" of "ETH Ethereum"
6. In the middle panel, select the "BIP44" Derivation Path tab.
7. The private key is in the first row of the Derived Addresses panel in the "Private Key" column, copy this value to a scratch text buffer (don't save it)
8. The address is the in the first row of the Derived Addresses panel in the "Address" column, copy this value to a scratch text buffer (don't save it)
9. Close the incognito window that has the private key.
10. You may now reconnect peripherals and turn your WIFI back on.
11. Set the private key for the payer in AWS `{env}_SAFE_TX_SENDER_PRIVATE_KEY` AWS Secrets Manager
12. Set the private key for the payer in AWS `{env}_SAFE_FUNDER_PRIVATE_KEY` AWS Secrets Manager
13. Transfer a significant amount of network native coins to the address of the gas payer.
14. Delete and close the scratch text docs that were acting as your copy-paste buffer
15. Taint the terraform EBS volumes and EC2 instances for the relayer and redeploy the relay service from terraform.
16. Navigate to the relay service for the environment and confirm that the /api/v1/about/ information reflects the address of the payer that you just setup.

## Token Bridge 
The token bridge is responsible for transfer token ownership between two chains. Within this repo, the only relevant contract is Bridge Utils. Bridge Utils is a utility contract (not the bridge contract) that exist on HOME (dai) network.

### updateToken
Adds both a payable token (such as DAICPXD) to the revenue pool and the prepaid card manager. This enables the token to be paid to revenue pool for purchase of prepaid card and spends to be deducted from a prepaid card credit. Only a tally admin can execute this. 

### updateSupplier 
Updates details of supplier, namely brandName and brandProfileUrl

### registerSupplier 
Register a new supplier. A suppliers (a gnosis safe) role  is to provide tokens from L1 to be bridged to L2. A supplier is a supplier of L1 tokens and prepaid cards (the two is bridged), the act of registering suggest that the person will issue prepaid cards. The supplier is a gnosis safe. 

### isRegistered  
Checks if a supplier is registered.




