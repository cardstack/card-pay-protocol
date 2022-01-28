pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract RewardManagerUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant rewardProgramIDsSlot = 209;
  uint256 internal constant eip1271ContractsSlot = 211;
  uint256 internal constant rewardSafesSlot = 213;

  function upgrade() external override upgrader {
    _upgradeEnumerableAddressSet(bytes32(rewardProgramIDsSlot));
    _upgradeEnumerableAddressSet(bytes32(eip1271ContractsSlot));

    NewAddressSet storage rewardProgramIDs;
    assembly {
      rewardProgramIDs.slot := rewardProgramIDsSlot
    }

    // Note: unbounded iteration bad but this is only for lightly used
    // reward manager part and tested against sokol / xdai data at time
    // of migration
    for (uint256 i = 0; i < rewardProgramIDs._inner._values.length; i++) {
      _upgradeEnumerableAddressSet(
        _addressSetValueSlot(
          rewardSafesSlot,
          rewardProgramIDs._inner._values[i]
        )
      );
    }

    _upgradeFinished();
  }
}
