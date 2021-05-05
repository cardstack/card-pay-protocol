pragma solidity 0.5.17;

interface IDIAOracle {
  function getValue(string calldata pair)
    external
    view
    returns (uint128, uint128);
}
