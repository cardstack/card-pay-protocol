pragma solidity ^0.5.17;

contract Versionable {
  string internal _version = "0.1.4";

  function cardProtocolVersion() external view returns (string memory) {
    return _version;
  }

  uint256[50] private ____gap;
}
