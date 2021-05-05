pragma solidity 0.5.17;

import "../oracles/IDIAOracle.sol";
import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";

// This contract is purely for testing and not meant to be deployed
contract MockDIAOracle is Ownable, IDIAOracle {
  struct PriceData {
    uint128 price;
    uint128 updatedAt;
  }

  mapping(bytes32 => PriceData) internal data;

  function setValue(
    string memory pair,
    uint128 price,
    uint128 updatedAt
  ) public onlyOwner {
    bytes32 key = keccak256(bytes(pair));
    data[key].price = price;
    data[key].updatedAt = updatedAt;
  }

  function getValue(string calldata pair)
    external
    view
    returns (uint128, uint128)
  {
    PriceData memory priceData = data[keccak256(bytes(pair))];
    return (priceData.price, priceData.updatedAt);
  }
}
