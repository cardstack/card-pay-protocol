pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "../libraries/EnumerableSetUnboundedEnumerable.sol";

contract SPENDMinterRole is Initializable, ContextUpgradeable {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
  using EnumerableSetUnboundedEnumerable for EnumerableSetUpgradeable.AddressSet;

  EnumerableSetUpgradeable.AddressSet internal minter;
  address private _owner;

  event OwnershipTransferred(
    address indexed previousOwner,
    address indexed newOwner
  );
  event MinterAdded(address indexed minter);
  event MinterRemoved(address indexed minter);

  /**
   * @dev Throws if called by any account other than the minter.
   */
  modifier onlyMinter() {
    require(minter.contains(_msgSender()), "caller is not a minter");
    _;
  }

  /**
   * @dev Throws if called by any account other than the owner.
   */
  modifier onlyOwner() {
    require(isOwner(), "caller is not the owner");
    _;
  }

  function addMinter(address _minter) external onlyOwner returns (bool) {
    return _addMinter(_minter);
  }

  function removeMinter(address _minter) external onlyOwner returns (bool) {
    return _removeMinter(_minter);
  }

  function getMinters() external view returns (address[] memory) {
    return minter.enumerate();
  }

  /**
   * @dev Initializes the contract setting the deployer as the initial owner.
   */
  function initializeMinterRole(address sender) internal onlyInitializing {
    _owner = sender;
    emit OwnershipTransferred(address(0), _owner);
  }

  function _addMinter(address _minter) internal returns (bool) {
    minter.add(_minter);
    emit MinterAdded(_minter);
    return true;
  }

  function _removeMinter(address _minter) internal returns (bool) {
    minter.remove(_minter);
    emit MinterRemoved(_minter);
    return true;
  }

  /**
   * @dev Returns the address of the current owner.
   */
  function owner() external view returns (address) {
    return _owner;
  }

  /**
   * @dev Returns true if the caller is the current owner.
   */
  function isOwner() public view returns (bool) {
    return _msgSender() == _owner;
  }

  /**
   * @dev Leaves the contract without owner. It will not be possible to call
   * `onlyOwner` functions anymore. Can only be called by the current owner.
   *
   * > Note: Renouncing ownership will leave the contract without an owner,
   * thereby removing any functionality that is only available to the owner.
   */
  function renounceOwnership() external onlyOwner {
    emit OwnershipTransferred(_owner, address(0));
    _owner = address(0);
  }

  /**
   * @dev Transfers ownership of the contract to a new account (`newOwner`).
   * Can only be called by the current owner.
   */
  function transferOwnership(address newOwner) external onlyOwner {
    _transferOwnership(newOwner);
  }

  /**
   * @dev Transfers ownership of the contract to a new account (`newOwner`).
   */
  function _transferOwnership(address newOwner) internal {
    require(newOwner != address(0), "new owner is the zero address");
    emit OwnershipTransferred(_owner, newOwner);
    _owner = newOwner;
  }

  uint256[50] private ____gap;
}
