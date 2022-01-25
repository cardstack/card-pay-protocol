pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract PrepaidCardManagerUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant contractSignersSlot = 217;

  function upgrade() external override upgrader {
    _upgradeEnumerableAddressSet(bytes32(contractSignersSlot));
    _upgradeFinished();
  }
}
