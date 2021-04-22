pragma solidity 0.5.17;

import "./core/Safe.sol";
import "./core/Exchange.sol";
import "./roles/PayableToken.sol";
import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";

contract BridgeUtils is Initializable, Safe, Ownable {
  event Setup();
  event SupplierWallet(address owner, address wallet);
  event UpdateToken(address token);
  event SupplierUpdated(address supplier);

  struct Supplier {
    bool registered;
    address safe;
    string brandName;
    string brandProfileUrl;
  }

  mapping(address => Supplier) public suppliers;
  mapping(address => address) public safes;

  address public revenuePool;
  address public prepaidCardManager;
  address public bridgeMediator;

  modifier onlyBridgeMediator() {
    require(msg.sender == bridgeMediator, "caller is not a bridge mediator");
    _;
  }

  function isRegistered(address supplierAddr) public view returns (bool) {
    return suppliers[supplierAddr].registered;
  }

  function setup(
    address _revenuePool,
    address _prepaidCardManager,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address _bridgeMediator
  ) public onlyOwner returns (bool) {
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
    revenuePool = _revenuePool;
    prepaidCardManager = _prepaidCardManager;
    bridgeMediator = _bridgeMediator;
    emit Setup();

    return true;
  }

  function updateSupplier(
    string calldata brandName,
    string calldata brandProfileUrl
  ) external returns (bool) {
    address safeAddr = msg.sender;

    // perhaps we want to allow the owner of the contract to be able to set
    // this as well just in case?
    address supplier = safes[safeAddr];
    require(supplier != address(0), "Supplier is invalid");
    require(suppliers[supplier].registered, "Do not have supplier for safe");

    suppliers[supplier].brandName = brandName;
    suppliers[supplier].brandProfileUrl = brandProfileUrl;

    emit SupplierUpdated(supplier);
    return true;
  }

  function registerSupplier(address ownerAddr)
    external
    onlyBridgeMediator
    returns (address)
  {
    return _registerSupplier(ownerAddr);
  }

  function _updateToken(address tokenAddr) internal returns (bool) {
    require(
      Exchange(revenuePool).hasExchange(tokenAddr),
      "No exchange exists for token"
    );
    // update payable token for token
    PayableToken(revenuePool).addPayableToken(tokenAddr);
    PayableToken(prepaidCardManager).addPayableToken(tokenAddr);
    emit UpdateToken(tokenAddr);
    return true;
  }

  function updateToken(address tokenAddr)
    external
    onlyBridgeMediator
    returns (bool)
  {
    return _updateToken(tokenAddr);
  }

  function _registerSupplier(address ownerAddr) internal returns (address) {
    address safe = createSafe(ownerAddr);
    suppliers[ownerAddr].registered = true;
    suppliers[ownerAddr].safe = safe;
    safes[safe] = ownerAddr;

    emit SupplierWallet(ownerAddr, safe);
    return safe;
  }
}
