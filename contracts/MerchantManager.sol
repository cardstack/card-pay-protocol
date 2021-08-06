pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";

import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./ActionDispatcher.sol";
import "./deprecated/DeprecatedMerchantManager.sol";

contract MerchantManager is Ownable, Versionable, Safe {
  using EnumerableSet for EnumerableSet.AddressSet;

  event Setup();
  event MerchantCreation(
    address merchant,
    address merchantSafe,
    string infoDID
  );

  address public deprecatedMerchantManager;
  address public actionDispatcher;
  mapping(address => EnumerableSet.AddressSet) internal merchants; // merchant address => enumeration of merchant safe addresses
  mapping(address => address) public merchantSafes; // merchant safe address => merchant address
  mapping(address => string) public merchantSafeInfoDIDs; // merchant safe address => Info DID

  modifier onlyHandlersOrOwner() {
    require(
      isOwner() || ActionDispatcher(actionDispatcher).isHandler(msg.sender),
      "caller is not a registered action handler nor an owner"
    );
    _;
  }

  function setup(
    address _actionDispatcher,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address _deprecatedMerchantManager
  ) external onlyOwner {
    actionDispatcher = _actionDispatcher;
    deprecatedMerchantManager = _deprecatedMerchantManager;
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
    emit Setup();
  }

  function isMerchantSafe(address merchantSafe) public view returns (bool) {
    return merchantSafes[merchantSafe] != address(0);
  }

  function upgradeMerchantSafe(address merchantSafe)
    public
    onlyOwner
    returns (bool)
  {
    require(
      deprecatedMerchantManager != address(0),
      "deprecated merchant manager is not set"
    );
    DeprecatedMerchantManager deprecated =
      DeprecatedMerchantManager(deprecatedMerchantManager);
    require(
      deprecated.isMerchantSafe(merchantSafe),
      "merchant safe is not registered"
    );
    address merchant = deprecated.merchantSafes(merchantSafe);
    (, string memory infoDID) = deprecated.merchants(merchant);
    merchantSafes[merchantSafe] = merchant;
    merchants[merchant].add(merchantSafe);
    merchantSafeInfoDIDs[merchantSafe] = infoDID;

    emit MerchantCreation(merchant, merchantSafe, infoDID);
    return true;
  }

  function merchantSafesForMerchant(address merchant)
    external
    view
    returns (address[] memory)
  {
    return merchants[merchant].enumerate();
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
}
