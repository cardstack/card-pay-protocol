pragma solidity ^0.8.9;
pragma abicoder v1;

import "./core/Ownable.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./ActionDispatcher.sol";
import "./VersionManager.sol";

contract MerchantManager is Ownable, Versionable, Safe {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  event Setup();
  event MerchantCreation(
    address merchant,
    address merchantSafe,
    string infoDID
  );
  event MerchantRegistrarAdded(address token);
  event MerchantRegistrarRemoved(address token);
  event MerchantSafeEnabled(address merchantSafe);
  event MerchantSafeDisabled(address merchantSafe);

  address public deprecatedMerchantManager;
  address public actionDispatcher;
  mapping(address => EnumerableSetUpgradeable.AddressSet) internal merchants; // merchant address => enumeration of merchant safe addresses
  mapping(address => address) public merchantSafes; // merchant safe address => merchant address
  mapping(address => string) public merchantSafeInfoDIDs; // merchant safe address => Info DID
  address public versionManager;
  EnumerableSetUpgradeable.AddressSet internal merchantAddresses;
  EnumerableSetUpgradeable.AddressSet internal merchantRegistrars;
  EnumerableSetUpgradeable.AddressSet internal disabledMerchantSafes;

  modifier onlyHandlersOrOwnerOrRegistrars() {
    require(
      (owner() == _msgSender()) ||
        ActionDispatcher(actionDispatcher).isHandler(msg.sender) ||
        merchantRegistrars.contains(msg.sender),
      "caller is not registered"
    );
    _;
  }

  modifier onlyOwnerOrRegistrars() {
    require(
      (owner() == _msgSender()) ||
        ActionDispatcher(actionDispatcher).isHandler(msg.sender) ||
        merchantRegistrars.contains(msg.sender),
      "caller is not an owner nor a registrar"
    );
    _;
  }

  function setup(
    address _actionDispatcher,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address[] calldata _merchantRegistrars,
    address _versionManager
  ) external onlyOwner {
    require(_actionDispatcher != address(0), "actionDispatcher not set");
    require(_versionManager != address(0), "versionManager not set");
    require(_gsMasterCopy != address(0), "gsMasterCopy not set");
    require(_gsProxyFactory != address(0), "gsProxyFactory not set");

    actionDispatcher = _actionDispatcher;
    versionManager = _versionManager;
    Safe.setup(_gsMasterCopy, _gsProxyFactory);

    for (uint256 i = 0; i < _merchantRegistrars.length; i++) {
      _addMerchantRegistrars(_merchantRegistrars[i]);
    }

    emit Setup();
  }

  function isMerchantSafe(address merchantSafe) external view returns (bool) {
    return merchantSafes[merchantSafe] != address(0);
  }

  function merchantSafesForMerchant(address merchant)
    external
    view
    returns (address[] memory)
  {
    return merchants[merchant].values();
  }

  function getMerchantRegistrars() external view returns (address[] memory) {
    return merchantRegistrars.values();
  }

  function _addMerchantRegistrars(address merchantRegistrarAddress)
    internal
    onlyOwner
  {
    merchantRegistrars.add(merchantRegistrarAddress);
    emit MerchantRegistrarAdded(merchantRegistrarAddress);
  }

  function removeMerchantRegistrar(address merchantRegistrarAddress)
    external
    onlyOwner
  {
    merchantRegistrars.remove(merchantRegistrarAddress);
    emit MerchantRegistrarRemoved(merchantRegistrarAddress);
  }

  function registerMerchant(address merchant, string calldata infoDID)
    external
    onlyHandlersOrOwnerOrRegistrars
    returns (address)
  {
    require(merchant != address(0), "zero address not allowed");

    address merchantSafe = createSafe(merchant);

    merchantSafes[merchantSafe] = merchant;
    merchantAddresses.add(merchant);
    merchants[merchant].add(merchantSafe);
    merchantSafeInfoDIDs[merchantSafe] = infoDID;

    emit MerchantCreation(merchant, merchantSafe, infoDID);

    return merchantSafe;
  }

  function getMerchantAddresses() external view returns (address[] memory) {
    return merchantAddresses.values();
  }

  function isMerchantSafeDisabled(address _merchantSafe)
    external
    view
    returns (bool)
  {
    return disabledMerchantSafes.contains(_merchantSafe);
  }

  function getDisabledMerchantSafes() external view returns (address[] memory) {
    return disabledMerchantSafes.values();
  }

  function enableSafe(address _merchantSafe) external onlyOwnerOrRegistrars {
    disabledMerchantSafes.remove(_merchantSafe);
    emit MerchantSafeEnabled(_merchantSafe);
  }

  function disableSafe(address _merchantSafe) external onlyOwnerOrRegistrars {
    disabledMerchantSafes.add(_merchantSafe);
    emit MerchantSafeDisabled(_merchantSafe);
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
