pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract SPENDUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant MINTER_SLOT = 101;
  uint256 internal constant SPEND_OWNER_SLOT = 103;

  function owner() public view override returns (address _owner) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      _owner := sload(SPEND_OWNER_SLOT)
    }
  }

  function upgrade() external override upgrader {
    _upgradeEnumerableAddressSet(bytes32(MINTER_SLOT));
    _upgradeFinished();
  }
}
