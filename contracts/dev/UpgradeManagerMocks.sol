pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";
import "../UpgradeManager.sol";

contract UpgradeableContractV1 is Ownable {
  function version() external pure returns (string memory) {
    return "1";
  }
}

contract UpgradeableContractV2 is Ownable {
  string public foo;

  function version() external pure returns (string memory) {
    return "2";
  }

  function setup(string calldata _foo) external {
    foo = _foo;
  }
}

contract UpgradedUpgradeManager is UpgradeManager {
  function newFunction() external pure returns (string memory) {
    return "UpgradedUpgradeManager";
  }
}
