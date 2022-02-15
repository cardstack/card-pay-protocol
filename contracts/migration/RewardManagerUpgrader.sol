pragma solidity ^0.8.9;
pragma abicoder v1;

import "./EnumerableSetUpgradeUtil.sol";

contract RewardManagerUpgrader is EnumerableSetUpgradeUtil {
  uint256 internal constant REWARD_PROGRAM_IDS_SLOT = 209;
  uint256 internal constant EIP1271_CONTRACTS_SLOT = 211;
  uint256 internal constant REWARD_SAFES_SLOT = 213;

  function upgrade() external override upgrader {
    _upgradeEnumerableAddressSet(bytes32(REWARD_PROGRAM_IDS_SLOT));
    _upgradeEnumerableAddressSet(bytes32(EIP1271_CONTRACTS_SLOT));

    NewAddressSet storage rewardProgramIDs;
    // solhint-disable-next-line no-inline-assembly
    assembly {
      rewardProgramIDs.slot := REWARD_PROGRAM_IDS_SLOT
    }

    // Note: unbounded iteration bad but this is only for lightly used
    // reward manager part and tested against sokol / xdai data at time
    // of migration
    for (uint256 i = 0; i < rewardProgramIDs._inner._values.length; i++) {
      _upgradeEnumerableAddressSet(
        _addressSetValueSlot(
          REWARD_SAFES_SLOT,
          rewardProgramIDs._inner._values[i]
        )
      );
    }

    _upgradeFinished();
  }
}
