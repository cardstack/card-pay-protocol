pragma solidity ^0.8.9;
pragma abicoder v1;

contract UpgradeableContractV1 {
  function version() public pure returns (string memory) {
    return "1";
  }
}

contract UpgradeableContractV2 {
  function version() public pure returns (string memory) {
    return "2";
  }
}
