pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";

contract UpgradeableContractV1 is Ownable {
  function version() public pure returns (string memory) {
    return "1";
  }
}

contract UpgradeableContractV2 is Ownable {
  string public foo;

  function version() public pure returns (string memory) {
    return "2";
  }

  function setup(string calldata _foo) external {
    foo = _foo;
  }
}
