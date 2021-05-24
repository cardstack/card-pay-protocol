![main status](https://github.com/cardstack/card-protocol-xdai/actions/workflows/main.yml/badge.svg)
# Card Protocol Contracts
The project hosts the contracts that comprise the Card Protocol. This includes the Prepaid Card Manager, Revenue Pool, SPEND token, and L2 Payment Token (e.g. DAI-CPXD).

## About the Card Protocol
The Card Protocol is a set of contracts that are used to support commerce functions within the Cardstack ecosystem. This is includes fiat on-ramping, support for suppliers of prepaid cards via token bridging, the ability for merchants to sell digital goods and be paid by customers with prepaid cards.
![Card Protocol Flow Diagram](https://user-images.githubusercontent.com/61075/116917836-2d5c8800-ac1d-11eb-991f-0ab53bd2cb67.png)

The sequence diagram above depicts the flow of funds through the Card Protocol. The idea is starting from the left:
1. A *Supplier* bridges stable coin from Ethereum mainnet layer 1 into xDai layer 2 by sending stable coin to the token bridge.
2. The token bridge locks the layer 1 stable coin and mints a reciprocal layer 2 form of the locked token with the token suffix of "CPXD". So for example the DAI token would be minted as DAI.CPXD in layer 2. The token bridge will actually call into the Card Protocol to create a gnosis safe for the *Supplier* and place the newly minted layer 2 tokens in the gnosis safe for which the *Supplier* will be made an owner.
3. The *Supplier* will then use the funds from their gnosis safe to create a series of prepaid cards. The prepaid card is a gnosis safe that has 2 owners, where one owner is the `Supplier` and the other owner is the `PrepaidCardManager` contract. This safe requires 2 signatures in order to execute transactions, which means that the `PrepaidCardManager` contract needs to sign off on any transaction for the prepaid card gnosis safe.
4. *Customers* will go through a fiat on-ramp, whereby they exchange fiat currency for the ownership of a prepaid card created by the *Supplier*. As part of this purchase, the supplier will transfer ownership for one of the owners of the prepaid card gnosis safe to the customer (the `PrepaidCardManager` contract still retains its ownership of the prepaid card gnosis safe).
5. Meanwhile *Merchants* are registered into the Card Protocol, as part of the registration, a gnosis safe is created for the merchant. As a note, all the merchant addresses in the card protocol are assumed to be the address of the safe created for the merchant.
6. When a *Customer* is ready to purchase a product from a *Merchant*, the customer leverages a gnosis safe relay service function to call the `PrepaidCardManager.payForMerchant` method. This method will transfer the tokens used to pay a merchant into the `RevenuePool` contract.
7. At a later time, the *Merchant* can then withdraw the the funds held for them in the `RevenuePool` contract. This will be the layer 2 CPXD token.
8. At the merchant's choosing, they can bridge the layer 2 CPXD token back to layer 1. Because of the high gas fees in layer 1, likely the bridging back to layer 1 will only happen when the merchant has accrued enough layer 2 CPXD that it makes sense to offset the higher gas fees for bridging back to layer 1.

### Bridge Utils
The `BridgeUtils` contract manages the point of interaction between the token bridge's home mediator contract and the Card Protocol. When the token bridge encounters an allowed stablecoin that it hasn't encountered before, it will create a new token contract in layer 2 for that token, as part of this, the token bridge will also inform the Card Protocol about the new token contract address, such that the Card Protocol can accept the new CPXD form of the stablecoin as payment for the creation of new prepaid cards, as well as, payments by customers to merchants. Additionally, as part of the token bridging process, the bridged tokens are placed in a gnosis safe that is owned by the *Suppliers* (the initiators of the token bridging process). This allows for easy gas-less (from the perspective of the users of the protocol) transactions. The gnosis safe as part of the token bridging process is actually created by the `BridgeUtils` contract.
### Prepaid Card Manager
The `PrepaidCardManager` contract is responsible for creating the gnosis safes that are considered as *Prepaid Cards*. As part of this process, a gnosis safe is created when layer 2 CPXD tokens are sent to the `PrepaidCardManager` Contract (as part of the layer 2 CPXD token's ERC-677 `onTokenTransfer()` function). This gnosis safe represents a *Prepaid Card*. This safe is created with 2 owners:
1. The sender of the transaction, i.e. the *Supplier's* gnosis safe
2. The `PrepaidCardManager` contract itself.

As well as a threshold of 2 signatures in order to execute gnosis safe transactions. This approach means that the `PrepaidCardManager` contract needs to sign off on all transactions involving *Prepaid Cards*. As such the `PrepaidCardManager` contract allows *Prepaid Cards* to be able to perform the following functions:
- A *Prepaid Card* is allowed to be sliced into smaller face values, each of which is owned by the same 2 owners.
- A *Prepaid Card* is allowed to be transferred to a new owner, where the `PrepaidCardManager` contract still retains ownership, but the 2nd owner of the gnosis safe can be changed. A *Prepaid Card* is only allowed to be transferred one time (from a *Supplier* to a *Customer*).
- A *Prepaid Card* can be used to pay a *Merchant*. The *Merchant* must have been previously registered by the `RevenuePool` contract.

The `PrepaidCardManager` contract supports gnosis relay service for all of its functions, which means that it provides data payload, estimation, and signature functions for all the *Prepaid Card* capabilities above.


### Revenue Pool
The `RevenuePool` contract provides an escrow capability in the Card Protocol, where payments from *Customers* to *Merchants* are held in the `RevenuePool` contract, and *Merchants* can claim the proceeds of their sales by withdrawing tokens held by the `RevenuePool` on their behalf. The `RevenuePool` is configured as the recipient of ERC-677 tokens, and the `PrepaidCardManager` contract ultimately fashions a token transfer as part of paying a *Merchant* into the `RevenuePool` contract (with the *Merchant's* info in the call data of the token transfer). The `RevenuePool` will collect a percentage of the customer payment to the merchant as the "fees" for using teh Card Protocol (TBD), and the rest will be claimable by the merchant. Additionally, the `RevenuePool` will mint the equivalent of SPEND tokens (based on USD exchange rate) and place in the *Merchant's* safe.


### SPEND Token
The `SPEND` token contract is a simple token contract that has `mint` and `burn` functions and whose tokens are not transferrable. The `SPEND` token can be thought of as a ticket that the *Merchants* receive as part of being paid by customers. These tokens are an accounting mechanism used to track the cumulative amount of payments that a *Merchant* has received from *Customers*.


### Price Oracle
In order to determine the amount of SPEND token to mint for *Customer* payments to *Merchants, we require a price oracle to convert the CPXD stable coin to USD. To support this we will leverage price oracles from both chainlink and DIA. Chainlink will provide stablecoin USD rates, and DIA will provide CARD USD rates. Chainlink and DIA use different interfaces for their onchain price feeds. In order to present a consolidated representation of various token prices we have created an `IPriceOracle` interface that represents the consolidated interface for all our price oracles, as well as we have a `ChainlinkFeedAdapter` and a `DIAOracleAdapter` contract that implements the `IPriceOracle` interface. These adapter contracts allow us to wrap the on-chain feeds from these two different token price sources into a consolidated interface that we can query from our `RevenuePool` contract. We also provide the token rates in units of ETH in order to support various web client needd.

## Prerequisites
The following prerequisites are required for this project:
- NodeJS ver 14+
- Yarn
- jq (`brew install jq`)

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
We use a truffle provider that supports trezor hardware wallet signing for contract deployment. When deploying contracts make sure that your trezor hardware wallet is connectd to your computer's USB port.

1. **Fund the Wallet**

Determine the address that you are using to perform the deployment (usually we use the first address of the hardware wallet) and fund that wallet with enough native tokens (xDai tokens for the xDai network and SPOA for the Sokol network). There are faucets available here:

   - xDai Faucet: https://blockscout.com/xdai/mainnet/faucet
   - Sokol Faucet: https://blockscout.com/poa/sokol/faucet

1. **Deploy Contract (first time deploy)**

    **Staging:**
    For a staging deploy, deploy to the Sokol network by entering the following command (specify environment variables that contain the optional configuration if there are values that you want to deploy with (like an already existing CPXD tokens or home bridge mediator address, etc):
    ```sh
    yarn deploy:sokol
    ```

    **Production:**
    For a production deploy, deploy to the xDai network by entering the following command (specify environment variables that contain the optional configuration if there are values that you want to deploy with (like an already existing CPXD tokens or home bridge mediator address, etc):
    ```sh
    yarn deploy:xdai
    ```

    **Optional Configuration**

    As part of the contract deployment you may also provide the following environment variables to optionally configure the Card Protocol:
    - `GNOSIS_SAFE_MASTER_COPY` This defaults to the v1.2.0 version of the Gnosis safe master copy address: `0x6851d6fdfafd08c0295c392436245e5bc78b0185`
    - `GNOSIS_SAFE_FACTORY` This defaults to the v1.1.1 version of the Gnosis safe factory address: `0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B`
    - `TALLY` The address of the Tally contract which is responsible for withdrawing L2 tokens from the revenue pool on behalf of merchants when they wish to redeem their SPEND.
    - `BRIDGE_MEDIATOR` This is the address of the layer 2 token bridge contract. This defaults to a zero address.
    - `MINIMUM_AMOUNT` This is the minimum face value that a new prepaid card can be created with in units of SPEND. This defaults to 100 SPEND.
    - `MAXIMUM_AMOUNT` This is the maximum face value that a new prepaid card can be created with in units of SPEND. This defaults to 10,000,000 SPEND.
    - `PAYABLE_TOKENS` This is a comma separated list of bridged token addresses to pre-populate as tokens accepted by the Card Protocol
    - `GAS_FEE_RECEIVER` This is the address of an entity that will receive gas fees as prepaid cards are created. Ideally this is the relay gas payer address.
    - `GAS_FEE_CARD_WEI` This is the gas fee in units of CARD wei that is charged for the creation of each prepaid card.
    - `GAS_TOKEN` This is the gas token used for paying merchants. This should be the address of the CARD.CPXD token, which is our gas token.
    - `MERCHANT_FEE_PERCENTAGE` This is the numerator of the merchant fee percentage, where the denominator is 10<sup>8</sup>
    - `MERCHANT_REGISTRATION_FEE_IN_SPEND` This is the registration fee that merchants must pay to register in SPEND tokens.
    - `MERCHANT_FEE_RECEIVER` This is the address that will receive the merchant fees (presumably a gnosis safe on layer 2)

    The contract addresses that are created are saved in a `./openzeppelin/addresses-{network}.json` file.

    As of 4/1/2021 the total native network cost to deploy is 0.1934 units (SPOA in sokol), where the block gas limit is 12499976.

1. **Configure BridgeUtils**
   If the `BRIDGE_MEDIATOR` environment variable was not supplied (because the layer 2 token bridge contracts have not yet been deployed), then deploy the layer 2 token bridge contracts, and then configure the BridgeUtils contract with the address of the layer 2 token bridge contract. [Instructions to perform this are here.](./OPERATIONS.md#bridge-utils)

2. **Memorialize Contract State**
   OpenZeppelin captures state information about the contracts that have been deployed. It uses this information to determine whether its safe to upgrade future versions of the contract based on changes that have been made as well where to update the contracts. It is OpenZeppelin's strong recommendation that this contract state be under source control. This means that after the initial deploy and after subsequent contract upgrades we need to commit and merge changes to the `./.openzeppelin` folder. So make sure to `git commit` after any contract deploys and upgrades, as well as a `git push` to merge the commits back into the main branch so our representation of the state remains consistent.

3. **Set up Gas Tokens**
   After the Home Bridge Meditator has been setup to talk to the Card Protocol:
   - bridge the tokens that will be used for gas (all the supported stable coins and the CARD token).
   - Note the layer 2 *.CPXD address for each of the bridged tokens.
   - Login to the relay service's admin interface: http://<relay_service_url>/admin
   - Use the admin interface to add each of the stable coins and the CARD token as new tokens.
   - Fill out the form for each token by providing the details for each token. Make sure to check the "gas" checkbox for each token, and save the settings.

4. **Set up CARD Token Oracle for Relay Server**
   After we have bridged our *.CPXD tokens and have addresses for our *.CPXD token, set up the "Cardpay" oracle in the relay server to provide CARD => DAI exchange rates.
   - Login to the relay service's admin interface: http://<relay_service_url>/admin
   - Use the admin interface to add a new price oracle:
     - The name of the price oracle should be: `Cardpay`
     - The configuration of the price oracle should be:
        ```json
        {
          "cardpay_price_oracle_addresses": {
            "CARD": "ADDRESS_OF_CARD_CPXD"
          }
        }
        ```
    - Use the admin interface to add a new price oracle ticker:
      - Select the "Cardpay" oracle in the Price Oracle drop down
      - Select the "CARD.CPXD" token in the Token drop down
      - Set the Ticker field to `CARD/DAI`
      - Leave the "Inverse" checkbox unchecked
      - Click on the "Save" button and you should see the live price for CARD token in units of DAI (it should be less than 1.0)



5. **Configure Gas Token in PrepaidCardManager**
   After we have bridged CARD.CPXD tokens and have an address for CARD, we need to set the CARD.CPXD as the gas token. This can be done by executing the `PrepaidCardManager.setup()` function with all the current values set as the parameters, plus the gas token set as the address for the `CARD.CPXD` token.

6. **Fund Gas Tokens**
   In order for the gnosis relay to airdrop the CARD.CPXD gas token on newly created prepaid card safes, we need to fund the relay txn funder with CARD.CPXD tokens. Bridge a significant amount of CARD tokens from layer 1 to layer 2, and then use the cardpay-sdk to transfer the layer 2 CARD.CPXD tokens from the depot safe that contains the bridge CARD.CPXD to the gnosis relayer txn funder's address. (`curl https://<relay server>/api/v1/about/` to get this address).

## Upgrading Contracts
We use the Open Zeppelin SDK to manage our upgradable contracts (via truffle migration). Once a contract has been deployed we have the ability to change the logic in the contract while still retaining the contract state due to the way in which Open Zeppelin maintains proxy contracts and their corresponding implementations. [There are a few limitations to be made aware of when updating a contract, which is outlined in the OZ documentation.](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#modifying-your-contracts). The OZ tools will check for any violations to the limitations as part of upgrading the contract and let you know if your changes to the contract are indeed upgradable changes. After you have made changes to the contract that you wish upgrade perform the following:
1. `git pull` (or `fetch` and `merge` if you prefer) the latest from the `main` git branch.
2. `git commit` your contract update changes (if they have not been committed already)
3. Run the truffle deploy via yarn providing the network that you are deploying.  Make sure to use environment variables documented above to retain all the current card protocol settings, such as the home bridge mediator address, the CPXD tokens, gas fee receiver, etc.
   ```sh
   BRIDGE_MEDIATOR=<HOME BRIDGE ADDRESS> PAYABLE_TOKENS=<COMMA SEPARATED TOKEN ADDRESSES>, ... yarn deploy:<network>
   ```

4. `git add ./openzeppelin` to stage the updated contract state files.
5. `git commit` to commit the updated contract state files
6. Run the release script to tag a new version in github
   ```sh
   ./release.sh -n <NETWORK> -v <VERSION>
   ```
8. `git push` to merge the commits back into the main branch. These changes reflect the new contract upgrade state, and its very important that this state is shared with the team so it can remain consistent within our organization.

##
