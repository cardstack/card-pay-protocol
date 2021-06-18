pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./roles/PayableToken.sol";
import "./Exchange.sol";

contract BridgeUtils is Ownable, Versionable, Safe {
  event Setup();
  event SupplierWallet(address owner, address wallet);
  event TokenAdded(address token);
  event SupplierInfoDID(address supplier, string infoDID);

  struct Supplier {
    bool registered;
    address safe;
    string infoDID;
  }

  mapping(address => Supplier) public suppliers;

  address public revenuePool;
  address public prepaidCardManager;
  address public bridgeMediator;
  mapping(address => address) public safes;
  address public rewardPool;
  address public exchange;
  address public actionDispatcher;

  modifier onlyBridgeMediator() {
    require(msg.sender == bridgeMediator, "caller is not a bridge mediator");
    _;
  }

  modifier onlySupplierSafe() {
    require(safes[msg.sender] != address(0), "caller is not a supplier safe");
    _;
  }

  function isRegistered(address supplierAddr) public view returns (bool) {
    return suppliers[supplierAddr].registered;
  }

  function safeForSupplier(address supplierAddr) public view returns (address) {
    require(isRegistered(supplierAddr), "supplier is not registered");
    return suppliers[supplierAddr].safe;
  }

  function setup(
    address _exchange,
    address _actionDispatcher,
    address _revenuePool,
    address _prepaidCardManager,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address _bridgeMediator,
    address _rewardPool
  ) external onlyOwner returns (bool) {
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
    exchange = _exchange;
    actionDispatcher = _actionDispatcher;
    revenuePool = _revenuePool;
    prepaidCardManager = _prepaidCardManager;
    bridgeMediator = _bridgeMediator;
    rewardPool = _rewardPool;
    emit Setup();

    return true;
  }

  function addToken(address tokenAddr)
    external
    onlyBridgeMediator
    returns (bool)
  {
    return _addToken(tokenAddr);
  }

  function setSupplierInfoDID(string calldata infoDID)
    external
    onlySupplierSafe
    returns (bool)
  {
    address safeAddr = msg.sender;
    address supplier = safes[safeAddr];
    require(supplier != address(0), "Supplier is invalid");
    require(suppliers[supplier].registered, "Do not have supplier for safe");

    suppliers[supplier].infoDID = infoDID;
    emit SupplierInfoDID(supplier, infoDID);
    return true;
  }

  function registerSupplier(address ownerAddr)
    external
    onlyBridgeMediator
    returns (address)
  {
    return _registerSupplier(ownerAddr);
  }

  function _addToken(address tokenAddr) internal returns (bool) {
    require(
      Exchange(exchange).hasExchange(tokenAddr),
      "No exchange exists for token"
    );
    // update payable token for token
    PayableToken(revenuePool).addPayableToken(tokenAddr);
    PayableToken(prepaidCardManager).addPayableToken(tokenAddr);
    PayableToken(rewardPool).addPayableToken(tokenAddr);
    PayableToken(actionDispatcher).addPayableToken(tokenAddr);
    emit TokenAdded(tokenAddr);
    return true;
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
