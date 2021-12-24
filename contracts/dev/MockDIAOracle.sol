pragma solidity ^0.7.6;

import "../oracles/IDIAOracle.sol";
import "../core/Versionable.sol";
import "../core/Ownable.sol";
import "../VersionManager.sol";

// This contract is purely for testing and not meant to be deployed

contract MockDIAOracle is Ownable, Versionable, IDIAOracle {
  struct PriceData {
    uint128 price;
    uint128 updatedAt;
  }

  event Setup();

  mapping(bytes32 => PriceData) internal data;
  address public versionManager;

  function setup(address _versionManager) external onlyOwner returns (bool) {
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

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
    override
    returns (uint128, uint128)
  {
    PriceData memory priceData = data[keccak256(bytes(pair))];
    return (priceData.price, priceData.updatedAt);
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
