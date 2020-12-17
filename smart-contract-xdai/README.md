# README

## Requirements

- node 12
- solidity 0.5.x
- ganache-cli >= 6.12.1

## Build

Install ganache-cli(only one time).

```sh
npm i -g ganache-cli
```

```sh
npm install
```

## Compile contracts

```sh
npm run compile-contracts
```

## Run test

Start ganache-cli first.

```sh
ganache-cli -p 7777 -k istanbul
```

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

- Redeem token for the merchant when the merchant wants to redeem.

