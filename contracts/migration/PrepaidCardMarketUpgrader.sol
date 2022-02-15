pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract PrepaidCardMarketUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant INVENTORY_SLOT = 156;

  function upgradeChunk(bytes32[] calldata skus) external upgrader {
    for (uint256 i = 0; i < skus.length; i++) {
      _upgradeEnumerableAddressSet(
        _addressSetValueSlot(INVENTORY_SLOT, skus[i])
      );
    }
  }

  function upgradeFinished() external upgrader {
    _upgradeFinished();
  }
}
