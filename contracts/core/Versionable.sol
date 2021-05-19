pragma solidity 0.5.17;

contract Versionable {
  function cardProtocolVersion() external pure returns (string memory) {
    return "0.1.9";
  }

  uint256[50] private ____gap;
}
