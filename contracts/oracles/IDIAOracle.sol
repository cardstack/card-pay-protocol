pragma solidity ^0.8.9;
pragma abicoder v1;

interface IDIAOracle {
  function getValue(string calldata pair)
    external
    view
    returns (uint128, uint128);
}
