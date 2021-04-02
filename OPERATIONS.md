# Card Protocol Operations
This document describes various operations procedures for the on-going maintenance necessary for the Card Protocol, as well as procedures to aid in testing the Card Protocol. Many of these operations require "owner" access in order to execute. We'll use BlockScout and Metamask to perform these operations steps.

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

### Minting L2 Tokens
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the L2 token contract whose tokens you wish to mint (we keep a record of the deployed contracts at `smart-contract-xdai/addresses-{network}.json`) by entering the token contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Card Protocol Owner for the correct network in metamask
5. Locate the "Mint" row, it is most likely row 7.
6. In the "Mint" row, enter the address that will receive the L2 tokens
7. In the "Mint" row, enter the amount of tokens to min _in units of wei_. You can use this handy wei converter here https://eth-converter.com/. Enter the amount of tokens you with to transfer as units of "Ether", and the converter will display the corresponding amount in wei.
8. Click on the "Write" button in the "Mint" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the balance by clicking on the "Read Contract" tab, and enter the recipient's address in the "balanceOf" row, and clicking on the "Query" button. The value displayed will be in units of wei. Feel free to use the converter to see the balance in units of "ether".
