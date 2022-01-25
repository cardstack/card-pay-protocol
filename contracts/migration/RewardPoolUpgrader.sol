pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract RewardPoolUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant REWARD_POOL_OWNER_SLOT = 101;

  function owner() public view override returns (address _owner) {
    assembly {
      _owner := sload(REWARD_POOL_OWNER_SLOT)
    }
  }
}
