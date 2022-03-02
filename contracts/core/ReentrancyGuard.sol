pragma solidity ^0.8.9;
pragma abicoder v1;

contract ReentrancyGuard {
  // So this can be used in safe delegate implementations, where the storage of this contract is the safe storage,
  // we have to do assembly hax to store the reentrancy flag and can't just use
  // ReentrancyGuardUpgradeable from OZ because it expects a storage slot for its state that
  // will clobber safe storage

  // bytes32(uint256(keccak256("safe.delegate.reentrancy_flag")) - 1)
  bytes32 internal constant REENTRANCY_GUARD_SLOT =
    0x7712fbd67a2d5bda218f5373b681e9e155932a5fa44c9a20ed14fbb50f32636f;

  modifier nonReentrant() {
    bool _entered;

    assembly {
      _entered := sload(
        REENTRANCY_GUARD_SLOT
      )
    }

    require(!_entered, "reentrant call");

      assembly {
        sstore(REENTRANCY_GUARD_SLOT, true)
      }
    _;

      assembly {
        sstore(REENTRANCY_GUARD_SLOT, false)
      }
  }
}
