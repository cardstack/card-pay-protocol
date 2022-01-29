pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract MerchantManagerUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant MERCHANTS_SLOT = 206;
  uint256 internal constant MERCHANT_ADDRESSES_SLOT = 210;

  function upgradeChunk(address[] calldata merchants) external upgrader {
    NewAddressSet storage set;
    // solhint-disable-next-line no-inline-assembly
    assembly {
      set.slot := MERCHANT_ADDRESSES_SLOT
    }

    for (uint256 i = 0; i < merchants.length; i++) {
      add(set, merchants[i]);

      _upgradeEnumerableAddressSet(
        _addressSetValueSlot(MERCHANTS_SLOT, merchants[i])
      );
    }
  }

  function upgradeFinished() external upgrader {
    _upgradeFinished();
  }
}
