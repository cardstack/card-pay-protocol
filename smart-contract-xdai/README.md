# README

## Requirements

- node 12
- solidity 0.5.x
- ganache-cli >= 6.12.1

## Build

```sh
npm install
```

## Compile contracts

```sh
npm run compile-contracts
```

## Run test

Run tests

```sh
npm run test
```

Run test with coverage

```sh
npm run test:coverage
```

## Smart Contracts

### Roles

**[SPENDMinterRole.sol](./contracts/roles/SPENDMinterRole.sol)**

- Set up and verify permission who can call `mint` and `burn` method in SPEND token.

**[TallyRole.sol](./contracts/roles/TallyRole.sol)**

- Set up and verify permission who can manage merchant in `RevenuePool`.

**[PayableToken.sol](./contracts/roles/PayableToken.sol)**

- Set up and verify token which uses pay for the merchant.

### Token

**[SPEND.sol](./contracts/token/SPEND.sol)**

This is a smart contract for the SPEND token. Only `SPEND Minter Role` can call `mint` and `burn` method. We also remove other methods. SPEND is `Non-Transferable`.
Responsible for:

- Mint token for merchant wallet when customers pay for them.
- Burn token in merchant wallet.

**[DAICPXD.sol](./contracts/token/DAICPXD.sol)**

ERC677 Token

### Core

**[Exchange.sol](./contracts/core/Exchange.sol)**

- Compute exchange rate from other token and SPEND token

**[MerchantManager.sol](./contracts/core/MerchantManager.sol)**

Manage merchant.

Responsible for:

- Register new merchants.
- Create and add a new wallet for merchants.

### Revenue pool

**[RevenuePool.sol](./contracts/RevenuePool.sol)**

Responsible for:

- Receipt the token by customer prepaid card when they pay for merchant and lock token in revenue pool.

- Claim token by the merchant.

### PrepaidCardManager
**[PrepaidCardManager.sol](./contracts/PrepaidCardManager.sol)**

Responsible for:

- Customer use card pay for merchant.

- Create new card by issuers. 

- Transfer card from issuers to customers. 


## Flow payment. 



### xDai Contract address

Deployed by `0x2E687A2fa5eC9D8080156E0B52f7f054eC191d79`

#### Address table

|Contract|Address|
|--------|-------|
|Revenue pool|0xABc52fA2691fe0BfE66c4CeA321EF91550e6950f|
|PrepaidCardManager|0xfc487529B501e1fd554A8b1BF8AC2b0961783477|
|BridgeUtils|0x00e842bB0c4FDd3a2061ffC07299Bbdc7b40Fe39|
|ERC677Token|0xA18a5F3F8A3069e712f0611749639845EA10dAE8|
|SPEND| 0xcb5254d9b5f52D9b15692C18d415B31d2C46CbdF|


### Rinkeby Contract address

Deployed by `0xFf0A8d6240F6B44820fFaB7C2683Ff64a5b16D21`

|Contract|Address|
|--------|-------|
|Revenue pool|0x67262d47a3c92528EE5EF826b4be56c43cb75c43|
|PrepaidCardManager|0x75619C7070dF5329031761d4db6E092fb0083921|
|BridgeUtils|0x8D7C8D278253D96Dcfae8C84feb0267caBEE89fA|
|ERC677Token|0x1deb16008cc7bf2be3e02ad8f98fdc0f97e51358|
|SPEND| 0x935aB896777bEaae460a8AE876406b8c2a7173c2|
