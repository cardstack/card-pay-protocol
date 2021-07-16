# Card Protocol Operations
This document describes various operations procedures for the on-going maintenance necessary for the Card Protocol, as well as procedures to aid in testing the Card Protocol. Many of these operations require "owner" access in order to execute. We'll use BlockScout and Metamask to perform these operations steps.

- [Card Protocol Operations](#card-protocol-operations)
  - [Blockscout](#blockscout)
  - [Key Management](#key-management)
  - [Prepaid Card Manager](#prepaid-card-manager)
    - [Setup](#setup)
    - [Add Payable Token](#add-payable-token)
    - [Remove Payable Token](#remove-payable-token)
  - [Revenue Pool](#revenue-pool)
    - [Setup](#setup-1)
    - [Add Payable Token](#add-payable-token-1)
    - [Remove Payable Token](#remove-payable-token-1)
    - [Add Tally](#add-tally)
    - [Remove Tally](#remove-tally)
    - [Register Merchant](#register-merchant)
    - [Create Exchange](#create-exchange)
  - [Relay](#relay)
    - [Setup Payer](#setup-payer)
  - [Bridge Utils](#bridge-utils)
    - [Setup](#setup-2)
    - [Update Supplier](#update-supplier)
    - [Check Supplier Registration](#check-supplier-registration)
  - [Reward Pool](#reward-pool)
    - [Setup](#setup-tally)
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


## Prepaid Card Manager
The Prepaid Card Manager is responsible for creating Prepaid Cards and cosigning transactions that originate from the prepaid card. This may include paying merchants, splitting prepaid cards, or transferring prepaid card ownership.

### Setup
The `setup` function of the prepaid card manager allows us to configure some basic aspects of how this contract functions including:
- setting the Gnosis safe master copy address
- setting the Gnosis safe factory address
- setting the revenue pool contract address
- setting an array of L2 tokens that are accepted by the prepaid card manager
- setting the minimum face value of newly created prepaid cards (in units of SPEND tokens)
- setting the maximum face value of newly created prepaid cards (in units of SPEND tokens)
- setting the address that will receive the gas fee collected for the creation of new prepaid cards
- setting the amount of the gas fee that will be charged for creation of new prepaid cards

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the PrepaidCardManager. If you wish to retain the current value, then use the "Read Contract" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Contract" tab and reviewing all the fields that pertain to the setup parameters.

### Add Payable Token
The `addPayableToken` function allows the prepaid card manager to accept a new L2 token address to be used for creating a prepaid card.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "addPayableToken" row and enter the address for the L2 token that you wish to add as a payable token
6. Click on the "Write" button in the "addPayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was added by clicking on the "Read Contract" tab and looking at the "getTokens" row.

### Remove Payable Token
The `removePayableToken` function allows the prepaid card manager to no longer accept an L2 token address as a token that can be used to create a prepaid card.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the PrepaidCardManager contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "removePayableToken" row and enter the address for the L2 token that you wish to remove as a payable token
6. Click on the "Write" button in the "removePayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was removed by clicking on the "Read Contract" tab and looking at the "getTokens" row.

## Revenue Pool
The Revenue pool collects the L2 tokens used to pay merchants, and mints SPEND tokens that the merchants can redeem against the funds collected in the revenue pool.

### Setup
The `setup` function of the revenue pool allows us to configure some basic aspects of how this contract functions including:
- setting an array of Tally contract addresses (these are addresses that are allowed to invoke the redeem SPEND function on the revenue pool contract)
- setting the Gnosis safe master copy address
- setting the Gnosis safe factory address
- setting the SPEND token contract address
- setting an array of L2 tokens that are accepted by the revenue pool

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the RevenuePool. If you wish to retain the current value, then use the "Read Contract" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Contract" tab and reviewing all the fields that pertain to the setup parameters.

### Add Payable Token
The `addPayableToken` function allows the revenue pool to accept a new L2 token address to be used as payment to a merchant.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "addPayableToken" row and enter the address for the L2 token that you wish to add as a payable token
6. Click on the "Write" button in the "addPayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was added by clicking on the "Read Contract" tab and looking at the "getTokens" row.

### Remove Payable Token
The `removePayableToken` function allows the revenue pool to no longer accept an L2 token address to be used as payment to a merchant.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "removePayableToken" row and enter the address for the L2 token that you wish to remove as a payable token
6. Click on the "Write" button in the "removePayableToken" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the payable token was removed by clicking on the "Read Contract" tab and looking at the "getTokens" row.

### Add Tally
The `addTally` function adds an address that is permitted to call a function to redeem SPEND tokens on behalf of a merchant from the revenue pool.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "addTally" row and enter the address that is permitted to call the `claimToken()` function
6. Click on the "Write" button in the "addTally" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the tally address was added by clicking on the "Read Contract" tab and looking at the "getTallys" row.

### Remove Tally
The `removeTally` function removes an address that is permitted to call a function to redeem SPEND tokens on behalf of a merchant from the revenue pool.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "removeTally" row and enter the address that is no longer permitted to call the `claimToken()` function
6. Click on the "Write" button in the "removeTally" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the tally address was removed by clicking on the "Read Contract" tab and looking at the "getTallys" row.

### Register Merchant
The `registerMerchant` function adds the address of a merchant in the revenue pool that is permitted to accept payment with prepaid card as well as is able to redeem SPEND tokens from the revenue pool.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "registerMerchant" row and enter the merchant's address
6. Click on the "Write" button in the "registerMerchant" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the merchant was registered was added by setting the merchant's address in the isMerchant field and clicking on the "Query" button.

### Create Exchange
The `createExchange` function adds price oracle for a token that is capable of getting the USD price for a token as well as the ETH price for a token. This function takes as input a contract that implements the `IPriceOracle` interface and associates with to a token symbol (which correlates to the tokens that have been added to our TokenBridge allow list and enabled as valid tokens in both the PrepaidCardManager contract and the RevenuePool contract). After the exchange has been added the RevenuePool contract will be able to perform token conversions using the exchange rates that originate from the supplied contract.
1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RevenuePool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "createExchange" row and enter the token symbol (without the "CPXD" suffix, and the address of the contract that implements the `IPriceOracle` for this token.
6. Click on the "Write" button in the "createExchange" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the exchange was created was added by setting the token's CPXD address in the exchangeRateOf field and clicking on the "Query" button.


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

## Bridge Utils
The BridgeUtils contract is responsible for facilitating the Token Bridge's ability to move tokens from layer 1 into layer 2 (xDai), such that issuers can perform gasless transactions to create prepaid cards from the tokens that they have bridged into the layer 2 network.

### Setup
The `setup` function of the bridge utils allows us to configure some basic aspects of how this contract functions including:
- setting an array of Tally contract addresses (these are addresses that are allowed to invoke the redeem SPEND function on the revenue pool contract)
- setting the address of the revenue pool
- setting the address of the prepaid card manager
- setting the Gnosis safe master copy address
- setting the Gnosis safe factory address
- setting the address of the layer 2 token bridge contract

This function should be called if the layer 2 token bridge contract has not yet been configured for the Card Protocol.

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the BridgeUtils contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select the Trezor Card Protocol Owner for the correct network in metamask
5. Locate the "Setup" row and enter all the values (from above) that you wish to set for the BridgeUtils. If you wish to retain the current value, then use the "Read Contract" tab to look up the current value for any of the settings above.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Contract" tab and reviewing all the fields that pertain to the setup parameters.

### Update Supplier
The `updateSupplier` function allows a supplier to configure their details, specifically their brand name and a URL for their profile. The sender of this transaction needs to originate from the gnosis safe address assigned to the suppliers (the Card Protocol Owner cannot call this function).

Because this is a gnosis safe transaction, the gnosis safe application should be used to update a supplier's details. https://xdai.gnosis-safe.io/app (currently there is no sokol gnosis safe app).

### Check Supplier Registration
The `isRegistered` function allows us to know if a supplier has been registered.

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the BridgeUtils contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the BridgeUtils contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Read Contract" tab
3. Enter the supplier's "depot" gnosis safe address in the address field in the `isRegistered` row and click on the "Query" button.


## Reward Pool

The Reward pool is responsible for rewarding tokens to payee addresses at every payment cycle. For every payment cycle, the map of reward tokens to each payee address is recorded via a merkle root; payees will be able to withdraw their balance using a generated proof. 

### Setup Tally
The `setup` function of the reward pool allows us to configure the tally address. The wallet of tally address will be able to execute administrative functions on the reward pool, most importantly, "submitPayeeMerkleRoot".

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RewardPool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab.
3. Click on the "Connect to Metamask" tab.
4. Select the Trezor Card Protocol Owner for the correct network in metamask.
5. Locate the "Setup" row and enter tally address into the input field.
8. Click on the "Write" button in the "Setup" row.
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm the setup configuration by clicking on the "Read Contract" tab and reviewing the field "tally". 

### Submit Merkle Root

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RewardPool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab.
3. Click on the "Connect to Metamask" tab.
4. Select the Trezor Tally for the correct network in metamask.
5. To generate the merkle root, there is no convenient api to do so. But, you can run this [test file](https://github.com/cardstack/tally-service/blob/master/safe_transaction_service/history/tests/test_merkle_tree.py) with the payment list as your input data. Ensure that token address in input data used is the same as ones that you find from "getTokens" row in readProxy tab of TokenManager contract.
6. Locate the "submitPayeeMerkleRoot" row and enter merkle root into `payeeRoot` e.g. 0x1a5f943271002f4e099fe7128ef8a902a753e39479cedf5159fc8abda4f83ba4 (it should be a hex string 64 characters long excluding 0x)
7. Click on the "Write" button in the "submitPayeeMerkleRoot" row.
8. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
9. After the transaction has completed, you can confirm your submission of merkle root by returning to transaction page of the RewardPool contract. Additionally, you can inspect the field "numPaymentCycles" in readProxy tab to check that the payment cycle has incremented from before submission.

### Withdraw Rewards

1. In the blockscout explorer, select the network that you are working within (xDai or Sokol) and navigate to the RewardPool contract (we keep a record of the deployed contracts at `addresses-{network}.json`) by entering the contract address in the blockscout search field.
2. Select the "Write Contract" tab
3. Click on the "Connect to Metamask" tab
4. Select your User Wallet that controls the rewarded address (payee address) for the correct network in metamask. The rewarded address is usually the owner of a prepaid card. 
5. Navigate to tally's open api (staging: https://tally-service-staging.stack.cards/, production: TODO). Enter your address into `payee_address` field in `/merkle-proofs` api. You will get a list of objects that include proofs. Choose one object and extract the values for `proof` and `tokenAddress`.
6. Locate the "balanceForProof" at readProxy tab. Enter the token address into `payableToken`, the proof into `proof`, into each input field respectively. Repeat usual metamask steps and click button "Query". Take note of the balance.
7. Locate the "withdraw" row at writeProxy tab. Enter the token address into `payableToken`, the amount to withdraw in wei into `amount`,the proof into `proof`, into each input field respectively. The `amount` value cannot exceed balance in step 6.
8. Click on the "Write" button in the "withdraw" row. 
9. In the Metamask popup that appears click on the "Confirm" button. The default gas price selected is probably just fine since gas is so plentiful in Layer 2 networks.
10. After the transaction has completed, you can confirm your balance by entering your address in the the blockscout explorer search field. Inspect the Tokens tab to find transfers of new tokens.
