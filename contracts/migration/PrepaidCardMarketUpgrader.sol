pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract PrepaidCardMarketUpgrader is EnumerableSetUpgradeUtil {
  function upgradeFinished() external upgrader {
    _upgradeFinished();
  }
}
