pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";
import "../MerchantManager.sol";
import "hardhat/console.sol";

contract RevenuePoolUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant MERCHANT_MANAGER_SLOT = 158;
  uint256 internal constant BALANCES_SLOT = 159;

  function upgrade() external override upgrader {
    address merchantManagerAddress;
    // solhint-disable-next-line no-inline-assembly
    assembly {
      merchantManagerAddress := sload(MERCHANT_MANAGER_SLOT)
    }

    MerchantManager merchantManager = MerchantManager(merchantManagerAddress);

    address[] memory merchants = merchantManager.getMerchantAddresses();

    for (uint256 i = 0; i < merchants.length; i++) {
      address[] memory safes = merchantManager.merchantSafesForMerchant(
        merchants[i]
      );

      for (uint256 j = 0; j < safes.length; j++) {
        _upgradeEnumerableAddressSet(
          _addressSetValueSlot(BALANCES_SLOT, safes[j])
        );
      }
    }

    _upgradeFinished();
  }
}
