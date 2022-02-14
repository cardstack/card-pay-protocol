pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract PrepaidCardManagerUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant CONTRACT_SIGNERS_SLOT = 217;

  function upgrade() external override upgrader {
    _upgradeEnumerableAddressSet(bytes32(CONTRACT_SIGNERS_SLOT));
    _upgradeFinished();
  }
}
