pragma solidity 0.6.8;

// This contract exists solely to pull in the contracts from the CardPay-Contracts package,
// so that they are built by hardhat and included in the

import "CardPay-Contracts/contracts/BaseErc20.sol";
import "CardPay-Contracts/contracts/ExchangeMock.sol";
import "CardPay-Contracts/contracts/Inventory.sol";
import "CardPay-Contracts/contracts/LevelRegistrar.sol";
import "CardPay-Contracts/contracts/Market.sol";
