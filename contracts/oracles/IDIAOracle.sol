pragma solidity ^0.7.6;

interface IDIAOracle {
  function getValue(string calldata pair)
    external
    view
    returns (uint128, uint128);
}
