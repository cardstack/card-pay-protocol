![main status](https://github.com/cardstack/card-protocol-xdai/actions/workflows/main.yml/badge.svg)
# Card Pay Protocol Contracts
The project hosts the contracts that comprise the Card Protocol. This includes the Prepaid Card Manager, Revenue Pool, SPEND token, and L2 Payment Token (e.g. DAI-CPXD).

## About the Card Pay Protocol
The Card Pay Protocol is a set of contracts that are used to support commerce functions within the Cardstack ecosystem. This is includes fiat on-ramping, support for suppliers of prepaid cards via token bridging, the ability for merchants to sell digital goods and be paid by customers with prepaid cards.
![Card Protocol Flow Diagram](https://user-images.githubusercontent.com/61075/116917836-2d5c8800-ac1d-11eb-991f-0ab53bd2cb67.png)

The sequence diagram above depicts the flow of funds through the Card Protocol. The idea is starting from the left:
1. A *Supplier* bridges stable coin from Ethereum mainnet layer 1 into xDai layer 2 by sending stable coin to the token bridge.
2. The token bridge locks the layer 1 stable coin and mints a reciprocal layer 2 form of the locked token with the token suffix of "CPXD". So for example the DAI token would be minted as DAI.CPXD in layer 2. The token bridge will actually call into the Card Protocol to create a gnosis safe for the *Supplier* and place the newly minted layer 2 tokens in the gnosis safe for which the *Supplier* will be made an owner.
3. The *Supplier* will then use the funds from their gnosis safe to create a series of prepaid cards. The prepaid card is a gnosis safe that has 2 owners, where one owner is the `Supplier` and the other owner is the `PrepaidCardManager` contract. This safe requires 2 signatures in order to execute transactions, which means that the `PrepaidCardManager` contract needs to sign off on any transaction for the prepaid card gnosis safe.
4. *Customers* will go through a fiat on-ramp, whereby they exchange fiat currency for the ownership of a prepaid card created by the *Supplier*. As part of this purchase, the supplier will transfer ownership for one of the owners of the prepaid card gnosis safe to the customer (the `PrepaidCardManager` contract still retains its ownership of the prepaid card gnosis safe).
5. Meanwhile *Merchants* are registered into the Card Protocol, as part of the registration, a gnosis safe is created for the merchant. As a note, all the merchant addresses in the card protocol are assumed to be the address of the safe created for the merchant.
6. When a *Customer* is ready to purchase a product from a *Merchant*, the customer leverages a gnosis safe relay service function to call the `PrepaidCardManager.send` method, with a `payMerchant` action. This method will ultimately transfer the tokens used to pay a merchant into the `RevenuePool` contract.
7. At a later time, the *Merchant* can then withdraw the the funds held for them in the `RevenuePool` contract. This will be the layer 2 CPXD token.
8. At the merchant's choosing, they can bridge the layer 2 CPXD token back to layer 1. Because of the high gas fees in layer 1, likely the bridging back to layer 1 will only happen when the merchant has accrued enough layer 2 CPXD that it makes sense to offset the higher gas fees for bridging back to layer 1.

### TokenManager
The `TokenManager` contract contains the list of CPXD tokens that are allowed to participate in the card protocol. Other contracts query the `TokenManager` contract to determine if a token being presented is an allowed token in the card protocol.

### SupplierManager
The `SupplierManager` contract is used to register suppliers (entities that bring tokens into the card protocol) and provision gnosis safes for suppliers. The `BridgeUtils` contract uses the `SupplierManager` to get or create a safe for individuals that bridge tokens into the network in which the card protocol runs.

### BridgeUtils
The `BridgeUtils` contract manages the point of interaction between the token bridge's home mediator contract and the Card Protocol. When the token bridge encounters an allowed stablecoin that it hasn't encountered before, it will create a new token contract in layer 2 for that token, as part of this, the token bridge will also inform the Card Protocol about the new token contract address, such that the Card Protocol can accept the new CPXD form of the stablecoin as payment for the creation of new prepaid cards, as well as, payments by customers to merchants. Additionally, as part of the token bridging process, the bridged tokens are placed in a gnosis safe that is owned by the *Suppliers* (the initiators of the token bridging process). This allows for easy gas-less (from the perspective of the users of the protocol) transactions. The gnosis safe as part of the token bridging process is actually created by the `SupplierManager` contract that the `BridgeUtils` contract refers to.

### PrepaidCardManager
The `PrepaidCardManager` contract is responsible for creating the gnosis safes that are considered as *Prepaid Cards*. As part of this process, a gnosis safe is created when layer 2 CPXD tokens are sent to the `PrepaidCardManager` Contract (as part of the layer 2 CPXD token's ERC-677 `onTokenTransfer()` function). This gnosis safe represents a *Prepaid Card*. This safe is created with 2 owners:
1. The sender of the transaction, i.e. the *Supplier's* gnosis safe
2. The `PrepaidCardManager` contract itself.

As well as a threshold of 2 signatures in order to execute gnosis safe transactions. This approach means that the `PrepaidCardManager` contract needs to sign off on all transactions involving *Prepaid Cards*. As such the `PrepaidCardManager` contract allows *Prepaid Cards* to be able "send actions" by calling the `send()` function. The caller of the `PrepaidCardManager.send()` function (which is generally the txn sender of a gnosis safe relay server) specifies:
1. the "action" to send
2. the amount of §SPEND to send
3. a USD rate of the prepaid card's issuing token to use for the action
4. ABI encoded data as parameters for the "action" being sent
5. the prepaid card's EOA owner's signature to execute a gnosis tx for all the parameters specified above

The "send" message ultimately issues a gnosis safe tx to transfer the prepaid card's tokens to the `ActionDispatcher` contract with action and data, where the `ActionDispatcher` will dispatch the action to the appropriate contract to handle. As part of executing the gnosis transaction, a custom gas policy may be employed--this can be configured such that it is possible to specify on an action-by-action basis which token is used to pay for gas, and who is the gas recipient; such that it is possible to recoup the gas either out of the face value of the prepaid card or as a protocol fee that is charged to the recipient of the "action".

Examples of existing "actions" include:
- splitting a prepaid card (using a prepaid card to fund the creation of more prepaid cards)
- registering a merchant
- paying a merchant
- transferring a prepaid card.
- registering a new reward program
- provisioning a prepaid card to a customer

In the future prepaid cards will support actions that allow it to perform capabilities that will be expressed by rewards programs and the commerce protocol.

### ActionDispatcher
The `ActionDispatcher` receives actions that have been issued from the `PrepaidCardManager.send()` as gnosis safe transactions. The `ActionDispatcher` will confirm that the requested USD rate for the §SPEND amount falls within an acceptable range, and then will forward (via an ERC677 `transferAndCall()`) the action to the contract address that has been configured to handle the requested action.

### PayMerchantHandler
The `PayMerchantHandler` is a contract that handles the `payMerchant` action. This contract will receive merchant payment dispatched from the `ActionHandler`. This contract will mint `SPEND` tokens into the safe of the merchant that is being paid, as well as, this contract will collect a protocol fee from the payment to the merchant (this is to offset the gas charges for the merchant payment as well as to pay for the protocol itself). This contract sends the protocol fee to a designated address that is used to collect protocol fees. After collecting the protocol fee, the remaining amount of CPXD tokens will then be sent to the `RevenuePool` contract where the merchant can claim their revenue.

### RegisterMerchantHandler
The `RegisterMerchantHandler` is a contract that handles the `registerMerchant` action. This contract will receive merchant registration payments from the `ActionHandler`. This contract will call the `MerchantManager` contract to create a safe for the merchant, and send the collected registration payment to a designated address that is used to collect protocol fees.

### SplitPrepaidCardHandler
The `SplitPrepaidCardHandler` is a contract that handles the `split` action. This contract will receive a payment from a prepaid card to create more prepaid cards (along with ABI encoded data that describes how to provision the new prepaid cards) from the `ActionHandler`. This contract will then transfer tokens directly to the `PrepaidCardManager` thereby creating new prepaid cards in the same manner that prepaid cards are created when tokens are transferred directly from a gnosis safe into the `PrepaidCardManager`. Note that for each prepaid card that is created via the `PrepaidCardManager` (regardless of where the tokens originate from) a gas fee is collected by the `PrepaidCardManager` contract to offset the cost of the gas used to create each prepaid card.

### TransferPrepaidCardHandler
The `TransferPrepaidCardHandler` is a contract that handles the `transfer` action. This contract will receive a "transfer" action and an ABI encoded signature from the prepaid card's original EOA owner that authorizes the transfer of ownership from the `ActionHandler`. This contract will then call the `PrepaidCardManager.transfer()` function to perform a gnosis safe transfer of the prepaid card to the new EOA owner using the provided signature of the previous EOA owner of the prepaid card.

### RegisterRewardProgramHandler
The `RegisterRewardProgramHandler` is a contract that handles the `registerRewardProgram` action. This contract will receive reward program registration payments from the `ActionHandler`. This contract will call the `RewardManager` to register the reward program and set a _Reward Program Admin_. This contract sends the protocol fee (`rewardProgramRegistrationFeeInSpend`) to a designated address that is used to collect protocol fees (for rewards). See [reward glossary](#rewardmanager).

### RegisterRewardeeHandler
The `RegisterRewardeeHandler` is a contract that handles the `registerRewardee` action. This contract will receive rewardee registration payments from the `ActionHandler`. This contract will call the `RewardManager` to register _Rewardee_ under a reward program and create a reward safe for the rewardee. The prepaid card used for `registerRewardee` action will pay for the gas transaction cost in it's issuing token. See [reward glossary](#rewardmanager).

### LockRewardProgramHandler
The `LockRewardProgramHandler` is a contract that handles the `lockRewardProgram` action. This contract will call the `RewardManager` to update the lock state of the reward program, i.e. turn it on or off. The prepaid card used for `lockRewardProgram` will pay for the gas transaction cost in it's issuing token. See [reward glossary](#rewardmanager).

### UpdateRewardProgramAdminHandler
The `UpdateRewardProgramAdminHandler` is a contract that handles the `updateRewardProgramAdmin` action. This contract will call the `RewardManager` to update the _Reward Program Admin_ that CAN control and manage the reward program. The prepaid card used for `updateRewardProgramAdmin` will pay for the gas transaction cost in it's issuing token. See [reward glossary](#rewardmanager).

### AddRewardRuleHandler
The `AddRewardRuleHandler` is a contract that handles the `addRewardRule` action. This contract will call the `RewardManager` to add a rule to a reward program. The prepaid card used for `updateRewardProgramAdmin` will pay for the transaction cost gas in it's issuing token. See [reward glossary](#rewardmanager).

### PayRewardTokensHandler
The `PayRewardTokensHandler` is a contract that handles the `payRewardTokens` action. This contract will send token transfers to fill up the `RewardPool` with reward tokens for a particular reward program. The prepaid card used for `payRewardTokens` will pay for the transaction cost gas in it's issuing token. See [reward glossary](#rewardmanager).

### Exchange
The `Exchange` is a contract that handles converting to and from §SPEND tokens from any other CPXD token, as well as getting the current USD rate for any of the CPXD tokens (which accompanies calls to `PrepaidCardManager.send()`). This contract is also responsible to determining if the USD rate that is being requested by `PrepaidCardManager.send()` calls falls within an allowable margin. We use the idea of a "rate lock" as part of the way in which callers call the `PrepaidCardManager.send()` function. The reason being is that these calls are normally issued from a gnosis relay server in 2 steps. The first step is to get an estimation of the transaction and then generate a signature, and the second step is to issue the transaction with the data from the transaction estimate along with the signature. In between those 2 steps the USD rate for the prepaid card's issuing token may have changed. To accommodate USD rate fluctuations the caller is allowed to specify the USD rate they used as part of the transaction estimation. This contract will then determine if that requested rate is actually allowable given the current USD rate and a configured "rate drift" percentage. If the requested rate falls outside of the "rate drift" percentage, then the transaction will be reverted. To accommodate the fact that we allow the caller to provide the USD rate to use, we have a pessimistic prepaid card face value calculation that we employ in `PrepaidCardManager.faceValue()` which uses the most pessimistic rate allowable given the "rate drift percentage" to calculate the prepaid card's face value after it's been used at least one time.

### MerchantManager
The `MerchantManager` contract is used to create gnosis safes for *Merchants* and establish mapping between the *Merchant's* EOA address and their safe address.

### RevenuePool
The `RevenuePool` contract provides an escrow capability in the Card Protocol, where payments from *Customers* to *Merchants* are held in the `RevenuePool` contract, and *Merchants* can claim the proceeds of their sales by withdrawing tokens held by the `RevenuePool` on their behalf. The `RevenuePool` is configured as the recipient of ERC-677 tokens, and the `PayMerchantHandler` contract ultimately fashions a token transfer as part of paying a *Merchant* into the `RevenuePool` contract (with the *Merchant's* info in the call data of the token transfer).


### SPEND
The `SPEND` token contract is a simple token contract that has `mint` and `burn` functions and whose tokens are not transferrable. The `SPEND` token can be thought of as a ticket that the *Merchants* receive as part of being paid by customers. These tokens are an accounting mechanism used to track the cumulative amount of payments that a *Merchant* has received from *Customers*.


### IPriceOracle
In order to determine the amount of SPEND token to mint for *Customer* payments to *Merchants, we require a price oracle to convert the CPXD stable coin to USD. To support this we will leverage price oracles from both chainlink and DIA. Chainlink will provide stablecoin USD rates, and DIA will provide CARD USD rates. Chainlink and DIA use different interfaces for their onchain price feeds. In order to present a consolidated representation of various token prices we have created an `IPriceOracle` interface that represents the consolidated interface for all our price oracles, as well as we have a `ChainlinkFeedAdapter` and a `DIAOracleAdapter` contract that implements the `IPriceOracle` interface. These adapter contracts allow us to wrap the on-chain feeds from these two different token price sources into a consolidated interface that we can query from our `Exchange` contract. We also provide the token rates in units of ETH in order to support various web client needd.


### RewardManager

Glossary for rewards within Cardpay:

#### Roles:

- _Rewardee_: The EOA owner that receives reward tokens. A rewardee can be any participant within the cardpay ecosystem, such as _Supplier_, _Merchant_, _Customer_.
- _Reward Program Admin_: The EOA owner that is given authority to execute adminstrative functions for a `Reward Program` such as `updateRewardProgramAdmin`, `lockRewardProgram`.
- _Governance Admin_: The EOA (represented as dao) that has the authority to `removeRewardProgram`.
  
#### Entities:

- _Reward Program_: A program created to offer reward tokens _Rewardees_ based on a `rule`. For example, _Merchant_ might want to register a reward program to offer `Card.cpxd` tokens to _Customers_ who spend > 100 SPEND in a week.
- _Reward Safe_: Dual-owner safe owned by _Rewardee_ and `rewardManager`. The safe is used to collect and store rewards. If a _Rewardee_ doesn't have a _Reward Safe_, he needs to `registerRewardee` before the _Rewardee_ can claim accrued rewards.
- _Tally_: An offchain service that is responsible for computing rewards for a particular reward program; it determines how much reward token each _Rewardee_ deserves.

The `RewardManager` is the main administrative contract that enables management of a _Reward Programs_. The `RewardManager` store corresponding states that are executed through a set of prepaid card actions:

- [registerRewardProgram](#registerrewardprogramhandler)
- [registerRewardee](#registerrewardeehandler)
- [addRewardRule](#addrewardrulehandler)
- [lockRewardProgram](#lockrewardprogramhandler)
- [updateRewardProgramAdmin](#updaterewardprogramadminhandler)

The `RewardManager` is responsible for creating gnosis safes that are known as _Reward Safes_. More importantly, the `rewardManager` host the EIP1271 signature callback that restrict the functions that a _Reward Safe_ can execute. The two examples of this are:

- `withdrawFromRewardSafe`: this function enables any ERC677 reward tokens to be transferred out of the _Reward Safe_ after it has been claimed. The tokens transferred are used to pay for gas.
- `transferRewardSafe`: this function enables the EOA-portion of ownership to be transferred. The transaction is gasless and considered as cost to the protocol fees collected during `registerRewardee`. 

### RewardPool

The `RewardPool` is a contract that stores inventory of the reward tokens(CPXD tokens) to be distributed to _Rewardees_ for each _Reward Program_. The _Reward Program Admin_ will refill the `RewardPool` with reward tokens for it's _Reward Program_ when the balance gets low.

The `RewardPool` contract is also the interface in which _Tally_ delivers rewards to a list of _Rewardees_. We use merkle trees as a way to verify how many tokens a _Rewardee_ has claim to. For each `rewardCycle` (interval of blocks), _Tally_ will write a `root`(a 32 byte hash) and store corresponding `proofs`(bytes) in offchain-storage. These `proofs` are used by the _Rewardee_ to be verified against the `roots` and to claim reward tokens. 


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

Or to run in parallel execute:

```sh
yarn test:parallel
```

The tests include a gas report which provides the min, max, and avg gas consumed for all the public functions in the contract based on the gas consumed while running tests, as well as, the gas required to deploy the contracts.

To generate the test coverage report execute:
```sh
yarn test:coverage
```

Solidity contracts has a maximum deployed bytecode size of 24KB. When a contract is larger than this, you'll receive out-of-gas errors when attempting to deploy it. In our tests we attempt a deploy of all our contracts to ensure they are deployable. Additionally you can generate a report of all the contract sizes to see if there are any contracts nearing or exceeding the max 24KB limit.
```sh
yarn test:size
```

### Deploying to private network
If you desire to test the protocol in an ad hoc manner in a private network (hardhat), then first start an RPC node in its own terminal window:
```sh
npx hardhat node
```

Switch to a different terminal window and then perform the following steps:

1. Compile the contracts if you have recently made changes (otherwise the most recently built contracts will be deployed):
```sh
yarn build:clean
```

2. The deploy and configure the protocol in the private network:
```sh
yarn deploy:hardhat
```

3. You can use the hardhat console to introspect the protocol:
```sh
npx hardhat --network localhost console --no-compile
```

## Deployment
We use a provider that supports trezor hardware wallet signing for contract deployment. When deploying contracts make sure that your trezor hardware wallet is connectd to your computer's USB port.

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
    - `RATE_DRIFT_PERCENTAGE` This is the numerator of the percentage that represents the amount the requested USD rate is allowed to deviate from the actual rate when paying a merchant (where the actual rate comes from our configured oracle). The denominator for this fraction is 10<sup>8</sup>.
    - `MERCHANT_FEE_PERCENTAGE` This is the numerator of the merchant fee percentage, where the denominator is 10<sup>8</sup>
    - `MERCHANT_REGISTRATION_FEE_IN_SPEND` This is the registration fee that merchants must pay to register in SPEND tokens.
    - `MERCHANT_FEE_RECEIVER` This is the address that will receive the merchant fees (presumably a gnosis safe on layer 2)
    - `REWARD_FEE_RECIEVER` This is the address that will receive the reward registration fees (presumably a gnosis safe on layer 2)
    - `REWARD_PROGRAM_REGISTRATION_FEE_IN_SPEND` This is the registration fee that `rewardProgramAdmins` must pay to register a reward program.

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
We use the Open Zeppelin SDK to manage our upgradable contracts via hardhat scripts. Once a contract has been deployed we have the ability to change the logic in the contract while still retaining the contract state due to the way in which Open Zeppelin maintains proxy contracts and their corresponding implementations. [There are a few limitations to be made aware of when updating a contract, which is outlined in the OZ documentation.](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#modifying-your-contracts). The OZ tools will check for any violations to the limitations as part of upgrading the contract and let you know if your changes to the contract are indeed upgradable changes. After you have made changes to the contract that you wish upgrade perform the following:
1. `git pull` (or `fetch` and `merge` if you prefer) the latest from the `main` git branch.
2. `git commit` your contract update changes (if they have not been committed already)
3. Run the deploy via yarn providing the network that you are deploying.  Make sure to use environment variables documented above to retain all the current card protocol settings, such as the home bridge mediator address, the CPXD tokens, gas fee receiver, etc.
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
