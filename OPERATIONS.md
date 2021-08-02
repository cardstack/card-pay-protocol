# Card Protocol Operations
This document describes various operations procedures for the on-going maintenance necessary for the Card Protocol, as well as procedures to aid in testing the Card Protocol. Many of these operations require "owner" access in order to execute. We'll use BlockScout and Metamask to perform these operations steps.

- [Card Protocol Operations](#card-protocol-operations)
  - [Blockscout](#blockscout)
  - [Key Management](#key-management)
  - [Relay Server](#relay-server)
    - [Setup Payer](#setup-payer)
    - [Setup Gas Tokens](#setup-gas-tokens)
    - [Setup Oracles](#setup-oracles)
    - [Setup Price Ticker](#setup-price-ticker)
  - [PrepaidCardManager](#prepaidcardmanager)
    - [Setup](#setup)
    - [addGasPolicy](#addgaspolicy)
  - [ActionDispatcher](#actiondispatcher)
    - [Setup](#setup-1)
    - [addHandler](#addhandler)
    - [removeHandler](#removehandler)
  - [Exchange](#exchange)
    - [Setup](#setup-2)
    - [Create Exchange](#create-exchange)
  - [TokenManager](#tokenmanager)
    - [Setup](#setup-3)
    - [Add Payable Token](#add-payable-token)
    - [Remove Payable Token](#remove-payable-token)
  - [MerchantManager](#merchantmanager)
    - [Setup](#setup-4)
    - [Register Merchant](#register-merchant)
  - [SupplierManager](#suppliermanager)
    - [Setup](#setup-5)
    - [Register Supplier](#register-supplier)
  - [PayMerchantHandler](#paymerchanthandler)
    - [Setup](#setup-6)
  - [RegisterMerchantHandler](#registermerchanthandler)
    - [Setup](#setup-7)
  - [SplitPrepaidCardHandler](#splitprepaidcardhandler)
    - [Setup](#setup-8)
  - [TransferPrepaidCardHandler](#transferprepaidcardhandler)
    - [Setup](#setup-9)
  - [RevenuePool](#revenuepool)
    - [Setup](#setup-10)
  - [BridgeUtils](#bridgeutils)
    - [Setup](#setup-11)
  - [RewardPool](#rewardpool)
    - [Setup Tally](#setup-tally)
    - [Submit Merkle Root](#submit-merkle-root)
    - [Withdraw Rewards](#withdraw-rewards)

## Blockscout
These instructions are written from the perspective of using the Blockscout website to update our contracts. Blockscout is nice in that it requires no prior setup, aside from creating your metamask wallet.

## Key Management
For our deployment we'll utilize a Trezor Hardware wallet truffle provider that will allow us to use hardware wallets to sign transactions when running the truffle migration script when deploying new contracts, upgrading contracts, and sending transactions to configure the contracts. In order to initialize the Trezor wallets we'll generate **3 of 6** Shamir Backup (that way a developer could loose all the seeds and we could still recover). Each developer receives 3 shamir different shamir seeds will be disseminated via different secure protocols to the individuals performing the deployments. The Shamir seeds will be used to initialize the Trezor Model T hardware wallets, which will then be used to perform the contract deployments. https://wiki.trezor.io/Shamir_Backup

Of the 6 seeds generated:

* 3 seeds should be written with pen on paper, put in a safe and kept as backup
* The remaining 3 seeds should be distributed by different channels to each developer
* Each channel should only be used for one seed - so if sending a seed to 3 developers by Signal messenger, for example, only send the same seed to each developer, not 3 different seeds, so that an atttacker that compromises Signal would only have access to a single seed
* consider distributing one seed by postal mail if possible, so that of the 6 seeds, only 2 are ever entered in any way on a computer, the remaining 4 seeds having been written down from the trezor setup process with pen and paper

A single, 6 word [diceware](https://www.eff.org/dice) password should also be chosen to be used as the **passphrase** to the wallet when generating it. Reasoning: trezors, even with pin enabled, [are vulnerable to physical attacks](https://blog.trezor.io/our-response-to-the-read-protection-downgrade-attack-28d23f8949c6). Adding a passphrase ensures that physical access to the trezor restored from shamir seeds does not allow compromising the key.

The passphrase should be distributed to developers using a secure channel

The passphrase should only ever be entered on the trezor's on-screen keyboard, and never on any other device after initial distribution. **Never enter the passphrase except with the trezor keyboard.**

When developers restore the shamir seeds, they should enable the following protection for their trezor wallets:

1. [Pin protection](https://wiki.trezor.io/PIN)
2. [SD card protection](https://wiki.trezor.io/User_manual:SD_card_protection)

## Relay Server
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
13. Transfer a significant amount of CARD.CPXD the address of the gas payer.
14. Delete and close the scratch text docs that were acting as your copy-paste buffer
15. Taint the terraform EBS volumes and EC2 instances for the relayer and redeploy the relay service from terraform.
16. Navigate to the relay service for the environment and confirm that the /api/v1/about/ information reflects the address of the payer that you just setup.

### Setup Gas Tokens
Each of the CPXD tokens can be used to pay gas, so we must configure the relay server to recognize all the CPXD tokens as gas tokens.

1. First all the CPXD tokens must be bridged for the first time. The act of bridging a token from L1 to L2 causes the TokenBridge to create the CPXD token address.
2. Login to the relay server's /admin interface using the administrator's credentials
3. For each CPXD token click the Tokens "+Add" button
4. For each CPXD token enter:
   - the layer 2 CPXD token address that the TokenBridge assigned the CPXD token
   - the name of the CPXD token
   - the symbol of the CPXD token
   - a decimals value of "18"
   - check the "gas" check box
   - for the DAI.CPXD token specifically set the "Fixed eth conversion" to "1.0". For all the other tokens leave this field blank.
   - finally click "Save"

### Setup Oracles
For each of the CPXD tokens, with the exception of the DAI.CPXD token we must establish an oracle that the relay server can use to get the native coin value of the token in question.

1. Login to the relay server's /admin interface using the administrator's credentials
2. Click on the Price Oracles "+Add" button
3. Add a new price oracle named "Cardpay"
4. Set the configuration of the price oracle to:
    ```json
    {
      "cardpay_price_oracle_addresses": {
        "TOKEN_SYMBOL": "CARD_PROTOCOL_ORACLE",
        "CARD": "0xb4Fcc975c2b6A57dd5B3d9a3B6b144499f707c7d"
      }
    }
    ```
    where there is an entry for each non DAI.CPXD token that maps the token symbol (without the "CPXD suffix") to the Card protocol `IPriceOracle` contract address for the token in question. An example for the CARD token in sokol has been provided in the example above.
5. finally click "Save"

### Setup Price Ticker
For each of the CPXD tokens, with the exception of the DAI.CPXD token, we must establish a price ticker that maps the gas token to the price oracle in order to calculate the live rate for the CPXD token in native coin.
1. First create the gas tokens and price oracles using the instructions above
2. Login to the relay server's admin interface using the administrator's credentials
3. For each of the CPXD tokens, except the DAI.CPXD tokens:
    - Click on the Price oracle tickers "+Add" button
    - From the price oracle drop down, select the "Cardpay" price oracle
    - From the token drop down, select the CPXD token in question
    - In the ticker text field enter: ```TOKEN_SYMBOL/DAI```, without the ".CPXD" suffix. For example for CARD.CPXD, this would be entered: ```CARD/DAI```
    - finally click "save"
    - confirm that the newly created ticker shows the correct exchange rate for the CPXD token


## PrepaidCardManager
The Prepaid Card Manager is responsible for creating Prepaid Cards and cosigning transactions that originate from the prepaid card. This may include paying merchants, splitting prepaid cards, or transferring prepaid card ownership.

### Setup
The `setup` function of the prepaid card manager allows us to configure some basic aspects of how this contract functions including:
- setting the TokenManager address
- setting the SupplierManager address
- setting the Exchange contract address
- setting the Gnosis safe master copy address
- setting the Gnosis safe factory address
- setting the ActionDispatcher address
- setting the address that will receive the gas fee collected for the creation of new prepaid cards
- setting the amount of the gas fee that will be charged for creation of new prepaid cards
- the address of the official gas token (CARD.CPXD)
- setting the minimum face value of newly created prepaid cards (in units of SPEND tokens)
- setting the maximum face value of newly created prepaid cards (in units of SPEND tokens)

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the PrepaidCardManager. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

### addGasPolicy
The `addGasPolicy` function establishes the gas policy for a particular action; specifically: the token used to pay for gas and the entity that receives the gas payment from the gnosis execTransaction. This can be used to configure whether an action deducts the gas costs from the face value of the prepaid card, or whether the action defers the gas payment so that it can be collected via some other means (e.g. protocol fee).

This function is called with the following parameters:
- The name of the action for which you are adding a gas policy
- A boolean set to true if the prepaid card's issuing token should be used as the gas token
- A boolean set to true if the relay server's configured txn spender should receive the gas token (otherwise the gas token is paid back to the prepaid card)

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "addGasPolicy" row and enter all the values (from above) that you wish to set for the PrepaidCardManager. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "addGasPolicy" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.

## ActionDispatcher
The ActionDispatcher contract is used to dispatch Prepaid card actions to the contract that handles the respective action.
### Setup
The `setup` function of the ActionDispatcher allows us to configure:
- the TokenManager contract address
- the Exchange contract address
- the PrepaidCardManager address

This function should be called to setup the ActionDispatcher

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the ActionDispatcher contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
1. Select the "Write Proxy" tab
1. Click on the "Connect to Metamask" tab
1. Select the Trezor Card Protocol Owner for the correct network in metamask
1. Locate the "Setup" row and enter all the values (from above) that you wish to set for the ActionDispatcher. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
1. Click on the "Write" button in the "Setup" row.
1. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
1. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

### addHandler
The `addHandler` function of the ActionDispatcher allows a new action handler to be added to the set of action handlers that the ActionDispatcher will dispatch to. This function's parameters include:
- the contract address of the new handler
- the name of the action the new action handler will handle

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the ActionDispatcher contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
1. Select the "Write Proxy" tab
1. Click on the "Connect to Metamask" tab
1. Select the Trezor Card Protocol Owner for the correct network in metamask
1. Locate the "addHandler" row and enter the action handler contract address and its associated action name
1. Click on the "Write" button in the "addHandler" row.
1. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.

### removeHandler
The `removeHandler` function of the ActionDispatcher allows an action handler contract to be removed from the set of action handlers that the ActionDispatcher will dispatch to. This function's sole parameter is the name of the action to remove.

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the ActionDispatcher contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
1. Select the "Write Proxy" tab
1. Click on the "Connect to Metamask" tab
1. Select the Trezor Card Protocol Owner for the correct network in metamask
1. Locate the "removeHandler" row and enter the action name to remove
1. Click on the "Write" button in the "removeHandler" row.
1. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.

## Exchange
The Exchange contract is responsible for providing a consistent API for converting between different token and fiats currencies via underlying oracles.

### Setup
The `setup` function of the Exchange contract allows us to configure the "rate drift percentage" this is the amount that requested SPEND rates are allowed to differ from the current SPEND rate when using a prepaid card. The value specified here is as a decimals 8 uint256 value.

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the Exchange contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
1. Select the "Write Proxy" tab
1. Click on the "Connect to Metamask" tab
1. Select the Trezor Card Protocol Owner for the correct network in metamask
1. Locate the "Setup" row and enter the action name to remove
1. Click on the "Write" button in the "Setup" row.
1. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.

### Create Exchange
The `createExchange` function adds price oracle for a token that is capable of getting the USD price for a token as well as the ETH price for a token. This function takes as input a contract that implements the `IPriceOracle` interface and associates with to a token symbol.

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the Exchange contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "createExchange" row and enter the token symbol (without the "CPXD" suffix, and the address of the contract that implements the `IPriceOracle` for this token.
6. Click on the "Write" button in the "createExchange" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the exchange was created was added by setting the token's CPXD address in the exchangeRateOf field and clicking on the "Query" button.

## TokenManager
The TokenManager contract is used to keep track of the CPXD tokens, which are the fungible tokens that the Card Protocol recognizes as payable tokens. As new CPXD token contracts are created via the TokenBridge, they will be added as supported tokens to this contract.

### Setup
The `setup` function configures basic aspects of the TokenManager, including:
- The address of the BridgeUtils contract
- An array of CPXD tokens that have already been created

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the TokenManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the TokenManager. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

### Add Payable Token
The `addPayableToken` function allows the TokenManager to recognize a new L2 token address as a CPXD token.

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the TokenManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "addPayableToken" row and enter the address for the L2 token that you wish to add as a payable token
6. Click on the "Write" button in the "addPayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was added by clicking on the "Read Proxy" tab and looking at the "getTokens" row.

### Remove Payable Token
The `removePayableToken` function allows the TokenManager to no longer accept an L2 token as a CPXD token.

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the TokenManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "removePayableToken" row and enter the address for the L2 token that you wish to remove as a payable token
6. Click on the "Write" button in the "removePayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was removed by clicking on the "Read Proxy" tab and looking at the "getTokens" row.

## MerchantManager
The MerchantManager contract is used to manage merchants and their respective merchant safes.

### Setup
The `setup` function is used to configure basic aspects of the MerchantManager contract and allows us to set:
- The ActionDispatch address
- the Gnosis Safe master copy address
- the Gnosis Safe proxy factory address

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the MerchantManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the MerchantManager. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

### Register Merchant
The `registerMerchant` function adds the address of a merchant in the MerchantManager that is permitted to accept payment with prepaid card as well as is able to redeem SPEND tokens from the revenue pool. This process will provision the merchant with a gnosis safe that is used for collecting the merchant's revenue.

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the MerchantManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "registerMerchant" row and enter the merchant's address
6. Click on the "Write" button in the "registerMerchant" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the merchant was registered was added by setting the merchant's address in the isMerchant field and clicking on the "Query" button.

## SupplierManager
The SupplierManager contract is used to provision suppliers with a gnosis safe to hold tokens that suppliers bridge into layer 2.

### Setup
The `setup` function is used to configure basic aspects of the SupplierManager contract and allows us to set:
- The BridgeUtils address
- the Gnosis Safe master copy address
- the Gnosis Safe proxy factory address

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the SupplierManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the SupplierManager. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

### Register Supplier
The `registerSupplier` function adds the address of a supplier in the SupplierManager and associates the supplier's address with a gnosis safe so that the supplier can receive bridged tokens in their safe.

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the SupplierManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "registerSupplier" row and enter the merchant's address
6. Click on the "Write" button in the "registerSupplier" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.

## PayMerchantHandler
This contract handles "payMerchant" actions dispatched from the ActionDispatcher contract.

### Setup
The `setup` function is used to configure the PayMerchantHandler. This function configures:
- The ActionDispatcher address
- The MerchantManager address
- The PrepaidCardManager address
- The RevenuePool address
- The SPEND token address
- The TokenManager address

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PayMerchantHandler contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the PayMerchantHandler. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

## RegisterMerchantHandler
This contract handles the "registerMerchant" actions dispatched from the ActionDispatcher contract.
### Setup
The `setup` function is used to configure the RegisterMerchantHandler. This function configures:
- The ActionDispatcher address
- The MerchantManager address
- The PrepaidCardManager address
- The RevenuePool address
- The Exchange contract address
- The TokenManager address

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RegisterMerchantHandler contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the RegisterMerchantHandler. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

## SplitPrepaidCardHandler
This contract handles the "split" actions dispatched from the ActionDispatcher contract.
### Setup
The `setup` function is used to configure the SplitPrepaidCardHandler. This function configures:
- The ActionDispatcher address
- The PrepaidCardManager address
- The TokenManager address

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the SplitPrepaidCardHandler contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the SplitPrepaidCardHandler. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

## TransferPrepaidCardHandler
This contract handles the "transfer" actions dispatched from the ActionDispatcher contract.

### Setup
The `setup` function is used to configure the TransferPrepaidCardHandler. This function configures:
- The ActionDispatcher address
- The PrepaidCardManager address
- The TokenManager address

To call this function:
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the TransferPrepaidCardHandler contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the TransferPrepaidCardHandler. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.


## RevenuePool
The Revenue pool collects the L2 tokens used to pay merchants, and mints SPEND tokens that the merchants can redeem against the funds collected in the revenue pool.

### Setup
The `setup` function of the revenue pool allows us to configure some basic aspects of how this contract functions including:
- setting the Exchange contract address
- setting the MerchantManager address
- setting the ActionDispatcher address
- setting the PrepaidCardManager address
- setting the merchant fee receiver address
- setting the merchant fee percentage (as decimal 8 uint256)
- setting the merchant registration fee

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the RevenuePool. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

## BridgeUtils
The BridgeUtils contract is responsible for facilitating the Token Bridge's ability to move tokens from layer 1 into layer 2 (xDai), such that issuers can perform gasless transactions to create prepaid cards from the tokens that they have bridged into the layer 2 network.

### Setup
The `setup` function of the bridge utils allows us to configure some basic aspects of how this contract functions including:
- setting the TokenManager address
- setting the SupplierManager address
- setting the Exchange contract address
- setting the address of the layer 2 token bridge contract

This function should be called if the layer 2 token bridge contract has not yet been configured for the Card Protocol.

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the BridgeUtils contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the BridgeUtils. If you wish to retain the current value, then use the "Read Proxy" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing all the fields that pertain to the setup parameters.

## RewardPool

The Reward pool is responsible for rewarding tokens to payee addresses at every payment cycle. For every payment cycle, the map of reward tokens to each payee address is recorded via a merkle root; payees will be able to withdraw their balance using a generated proof.

### Setup Tally
The `setup` function of the reward pool allows us to configure the tally address. The wallet of tally address will be able to execute administrative functions on the reward pool, most importantly, "submitPayeeMerkleRoot".

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RewardPool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab.
3. Click on the "Connect to Metamask" tab.
4. Select the Trezor Card Protocol Owner for the correct network in metamask.
5. Locate the "Setup" row and enter tally address into the input field.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Proxy" tab and reviewing the field "tally".

### Submit Merkle Root

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RewardPool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab.
3. Click on the "Connect to Metamask" tab.
4. Select the Trezor Tally for the correct network in metamask.
5. To generate the merkle root, there is no convenient api to do so. But, you can run this [test file](https://github.com/cardstack/tally-service/blob/master/safe_transaction_service/history/tests/test_merkle_tree.py) with the payment list as your input data. Ensure that token address in input data used is the same as ones that you find from "getTokens" row in readProxy tab of TokenManager contract.
6. Locate the "submitPayeeMerkleRoot" row and enter merkle root into `payeeRoot` e.g. 0x1a5f943271002f4e099fe7128ef8a902a753e39479cedf5159fc8abda4f83ba4 (it should be a hex string 64 characters long excluding 0x)
7. Click on the "Write" button in the "submitPayeeMerkleRoot" row.
8. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
9. After the transaction has completed, you can confirm your submission of merkle root by returning to transaction page of the RewardPool contract. Additionally, you can inspect the field "numPaymentCycles" in readProxy tab to check that the payment cycle has incremented from before submission.

### Withdraw Rewards

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RewardPool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Proxy" tab
3. Click on the "Connect to Metamask" tab
4. Select your User Wallet that controls the rewarded address (payee address) for the correct network in metamask. The rewarded address is usually the owner of a prepaid card.
5. Navigate to tally's open api (staging: https://tally-service-staging.stack.cards/, production: TODO). Enter your address into `payee_address` field in `/merkle-proofs` api. You will get a list of objects that include proofs. Choose one object and extract the values for `proof` and `tokenAddress`.
6. Locate the "balanceForProof" at readProxy tab. Enter the token address into `payableToken`, the proof into `proof`, into each input field respectively. Repeat usual metamask steps and click button "Query". Take note of the balance.
7. Locate the "withdraw" row at writeProxy tab. Enter the token address into `payableToken`, the amount to withdraw in wei into `amount`,the proof into `proof`, into each input field respectively. The `amount` value cannot exceed balance in step 6.
8. Click on the "Write" button in the "withdraw" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm your balance by entering your address in the the blockscout explorer search field. Inspect the Tokens tab to find transfers of new tokens.
