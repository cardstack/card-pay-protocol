pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract TokenManagerUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant PAYABLE_TOKENS_SLOT = 152;

  function upgrade() external override upgrader {
    _upgradeEnumerableAddressSet(bytes32(PAYABLE_TOKENS_SLOT));
    _upgradeFinished();
  }
}
