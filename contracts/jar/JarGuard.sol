// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity ^0.8.9;
pragma abicoder v1;

import "@gnosis.pm/zodiac/contracts/interfaces/IAvatar.sol";
import "@gnosis.pm/zodiac/contracts/guard/BaseGuard.sol";
import "@gnosis.pm/zodiac/contracts/factory/FactoryFriendly.sol";
import "@gnosis.pm/safe-contracts/contracts/common/StorageAccessible.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../token/IERC677.sol";
import "./TankModule.sol";

contract JarGuard is FactoryFriendly, BaseGuard {
  using SafeMathUpgradeable for uint256;

  event JarGuardSetup(address indexed avatar, address[] modules);
  event ProtectedModulesSet(address[] protectedModules);
  event AvatarSet(address avatar);

  // Cannot disable this guard
  error CannotDisableThisGuard(address guard);

  // Cannot disable protected modules
  error CannotDisableProtecedModules(address module);

  address public avatar;
  address[] public protectedModules;
  address public tankModuleAddress;

  // keccak256("guard_manager.guard.address")
  bytes32 internal constant GUARD_STORAGE_SLOT =
    0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;
  // 0xa9059cbb - bytes4(keccak256("transfer(address,uint256)"))
  bytes4 public constant TRANSFER = 0xa9059cbb;

  constructor(
    address _owner,
    address _avatar,
    address[] memory _modules,
    address _tankModuleAddress
  ) {
    bytes memory initializeParams = abi.encode(
      _owner,
      _avatar,
      _modules,
      _tankModuleAddress
    );
    setUp(initializeParams);
  }

  /// @param initializeParams Parameters of initialization encoded
  function setUp(bytes memory initializeParams) public override initializer {
    __Ownable_init();
    (
      address _owner,
      address _avatar,
      address[] memory _modules,
      address _tankModuleAddress
    ) = abi.decode(initializeParams, (address, address, address[], address));

    avatar = _avatar;
    tankModuleAddress = _tankModuleAddress;
    setProtectedModules(_modules);
    transferOwnership(_owner);

    emit JarGuardSetup(_avatar, _modules);
  }

  function setProtectedModules(address[] memory _modules) public onlyOwner {
    protectedModules = _modules;
    emit ProtectedModulesSet(protectedModules);
  }

  function setAvatar(address _avatar) public onlyOwner {
    avatar = _avatar;
    emit AvatarSet(avatar);
  }

  // solhint-disallow-next-line payable-fallback
  fallback() external {
    // We don't revert on fallback to avoid issues in case of a Safe upgrade
    // E.g. The expected check method might change and then the Safe would be locked.
  }

  function checkTransaction(
    address to,
    uint256,
    bytes calldata data,
    Enum.Operation operation,
    uint256,
    uint256,
    uint256,
    address,
    // solhint-disallow-next-line no-unused-vars
    address payable,
    bytes memory,
    address
  ) external view override {
    require(
      operation != Enum.Operation.DelegateCall,
      "Delegate call not allowed to this address"
    );

    if (bytes4(data[:4]) == TRANSFER) {
      require(
        IERC677(to).balanceOf(avatar).sub(
          TankModule(tankModuleAddress).lockedAmount(to)
        ) >= getAmount(data),
        "cannot exceed balance - lockedBalance"
      );
    }
  }

  function checkAfterExecution(bytes32, bool) external view override {
    if (
      abi.decode(
        StorageAccessible(avatar).getStorageAt(uint256(GUARD_STORAGE_SLOT), 2),
        (address)
      ) != address(this)
    ) {
      revert CannotDisableThisGuard(address(this));
    }
    for (uint256 i = 0; i < protectedModules.length; i++) {
      if (!IAvatar(avatar).isModuleEnabled(protectedModules[i])) {
        revert CannotDisableProtecedModules(protectedModules[i]);
      }
    }
  }

  function getAmount(bytes calldata data) internal pure returns (uint256) {
    (, uint256 amount) = abi.decode(data[4:], (address, uint256));

    return amount;
  }
}
