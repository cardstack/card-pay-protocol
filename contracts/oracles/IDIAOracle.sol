pragma solidity ^0.8.9;
pragma abicoder v1;

// DIA is a company that is providing a CARD oracle on gnosis chain for us, not a mis-spelling
interface IDIAOracle {
  function getValue(string calldata pair)
    external
    view
    returns (uint128, uint128);
}
