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


### Addresses table

#### xDai Contract address

Deployed by `0x2E687A2fa5eC9D8080156E0B52f7f054eC191d79`

|Contract|Address|
|--------|-------|
|Revenue pool|0xf29e21D91A3B9C523D5e4e685e531284375E193a|
|PrepaidCardManager|0x07b32b79a4D885a3C4b9b0DdF26F311e9A091291|
|SPEND| 0x0482aA5C196276D8e0B76f8Fc019110f5a67F76d|


#### Rinkeby Contract address

Deployed by `0x2E687A2fa5eC9D8080156E0B52f7f054eC191d79`

|Contract|Address|
|--------|-------|
|Revenue pool|0x1183dc24D1cFea8A493296B621EF934C65ce7c55|
|PrepaidCardManager|0xE6646133B0dcd96500536B960b8BBc5AC50b095a|
|SPEND| 0x9BEe99cD9dc66B0D431D1e891F88e349F1646a4a|
