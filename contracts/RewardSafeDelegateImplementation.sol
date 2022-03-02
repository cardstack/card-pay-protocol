pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "./RewardManager.sol";
import "./ActionDispatcher.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

// This contract is used as an implementation for delegatecall usage of safe operations.
// It will never be called from it's own deployment address, whenever code here executes,
// address(this) will be the gnosis safe, and if you call a function on another contract,
// that other contract will see msg.sender as the safe address.

// When you inspect msg.sender in one of the functions in this contract called with delegatecall,
// it will be the relayer, not the safe address

// Because the arguments to the functions called with delegate call are all user-provided, they
// cannot be considered safe to trust. However, the reward manager contract validates the first
// argument, which must be it's own address.

// To avoid trusting user input, I have adopted a convention of prefixing arguments to the functions
// in this contract with __trusted__ or __untrusted__ to indicated if further validation should
// be performed before operating on the arguments

// solhint-disable var-name-mixedcase
contract RewardSafeDelegateImplementation {
  event RewardSafeWithdrawal(address rewardSafe, address token, uint256 value);
  event RewardSafeTransferred(
    address rewardSafe,
    address oldOwner,
    address newOwner
  );

  // Because this is a delegate implementation, the storage of this contract is the safe storage.
  // For that reason, we have to do assembly hax to store the reentrancy flag and can't just use
  // ReentrancyGuardUpgradeable

  // bytes32(uint256(keccak256("safe.delegate.reentrancy_flag")) - 1)
  bytes32 internal constant REENTRANCY_GUARD_SLOT =
    0x7712fbd67a2d5bda218f5373b681e9e155932a5fa44c9a20ed14fbb50f32636f;

  modifier nonReentrant() {
    bool _entered;
    assembly {
      _entered := sload(REENTRANCY_GUARD_SLOT)
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

  function withdraw(
    address __trusted__managerContract,
    address __untrusted__token,
    address __untrusted__to,
    uint256 __untrusted__value
  ) nonReentrant external {
    require(
      RewardManager(__trusted__managerContract).isValidToken(
        __untrusted__token
      ),
      "must be valid token"
    );

    IERC20Upgradeable(__untrusted__token).transfer(
      __untrusted__to,
      __untrusted__value
    );

    emit RewardSafeWithdrawal(
      address(this),
      __untrusted__token,
      __untrusted__value
    );
  }

  function swapOwner(
    address __trusted__managerContract,
    address __untrusted__prevOwner,
    address __untrusted__oldOwner,
    address __untrusted__newOwner
  ) external {
    RewardManager(__trusted__managerContract).willTransferRewardSafe(
      __untrusted__newOwner
    );

    _originalSafe().swapOwner(
      __untrusted__prevOwner,
      __untrusted__oldOwner,
      __untrusted__newOwner
    );

    emit RewardSafeTransferred(
      address(this),
      __untrusted__oldOwner,
      __untrusted__newOwner
    );
  }

  // It needs this casting to allow the lookup of this contract as the orignal
  // safe. But once you have it, you can call methods that are restricted to be
  // only called by the safe, because msg.sender is the safe address!
  function _originalSafe() private view returns (GnosisSafe) {
    address payable safeAddress = payable(address(this));
    return GnosisSafe(safeAddress);
  }
}
// solhint-enable var-name-mixedcase
