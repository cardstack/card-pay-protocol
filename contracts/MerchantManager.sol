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

  address public deprecatedMerchantManager;
  address public actionDispatcher;
  mapping(address => EnumerableSetUpgradeable.AddressSet) internal merchants; // merchant address => enumeration of merchant safe addresses
  mapping(address => address) public merchantSafes; // merchant safe address => merchant address
  mapping(address => string) public merchantSafeInfoDIDs; // merchant safe address => Info DID
  address public versionManager;

  modifier onlyHandlersOrOwner() {
    require(
      (owner() == _msgSender()) ||
        ActionDispatcher(actionDispatcher).isHandler(msg.sender),
      "caller is not a registered action handler nor an owner"
    );
    _;
  }

  function setup(
    address _actionDispatcher,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address _versionManager
  ) external onlyOwner {
    actionDispatcher = _actionDispatcher;
    versionManager = _versionManager;
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
    emit Setup();
  }

  function isMerchantSafe(address merchantSafe) public view returns (bool) {
    return merchantSafes[merchantSafe] != address(0);
  }

  function merchantSafesForMerchant(address merchant)
    external
    view
    returns (address[] memory)
  {
    return merchants[merchant].values();
  }

  function registerMerchant(address merchant, string calldata infoDID)
    external
    onlyHandlersOrOwner
    returns (address)
  {
    require(merchant != address(0), "zero address not allowed");

    address merchantSafe = createSafe(merchant);

    merchantSafes[merchantSafe] = merchant;
    merchants[merchant].add(merchantSafe);
    merchantSafeInfoDIDs[merchantSafe] = infoDID;

    emit MerchantCreation(merchant, merchantSafe, infoDID);

    return merchantSafe;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
