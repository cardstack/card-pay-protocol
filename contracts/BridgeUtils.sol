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
    string brandName;
    string brandProfileUrl;
  }

  mapping(address => Supplier) public suppliers;

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
    address supplierAddr = msg.sender;

    // perhaps we want to allow the owner of the contract to be able to set
    // this as well just in case?
    require(suppliers[supplierAddr].registered, "Supplier is invalid.");

    suppliers[supplierAddr].brandName = brandName;
    suppliers[supplierAddr].brandProfileUrl = brandProfileUrl;

    emit SupplierUpdated(supplierAddr);
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
    suppliers[safe].registered = true;

    emit SupplierWallet(ownerAddr, safe);
    return safe;
  }
}
