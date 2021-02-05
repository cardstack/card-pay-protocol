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

### Deployment 

Deploy to rinkeby 

```
npm run deploy-rinkeby
```

Deploy to xdai

```
npm run deploy-xdai
```

Output show in json format and it's also save in folder `address_book/<branch-name>.json`.

*Don't forget check the .env file before you deploy new contract.*

### Env config 

```
INFURA_API_KEY=<infura id>
MNEMONIC=<your seed>

TALLY=<tally address>

GNOSIS_SAFE_FACTORY=0x76E2cFc1F5Fa8F6a5b3fC4c8F4788F0116861F9B
GNOSIS_SAFE_MASTER_COPY=0x34CfAC646f301356fAa8B21e94227e3583Fe3F5F

PAYABLE_TOKEN= <list payable token, seperated by space>
#PAYABLE_TOKEN=0x1455c8331da57C6C6DfE3B4076Eb6381E136d0Be 0xd5eeD8cc6dDA145cf92bF586b9687201318260e2

// mininum amount of card when we create a new card. (in SPEND)
MINIMUM_AMOUNT=100 
// maxinum amount of card when we create a new card. (in SPEND)
MAXIMUM_AMOUNT=500000
```