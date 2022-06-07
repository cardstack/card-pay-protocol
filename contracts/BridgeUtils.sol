pragma solidity ^0.8.9;
pragma abicoder v1;

import "./core/Ownable.sol";
import "./core/Versionable.sol";
import "./TokenManager.sol";
import "./Exchange.sol";
import "./SupplierManager.sol";
import "./VersionManager.sol";

contract BridgeUtils is Ownable, Versionable {
  event Setup();
  event TokenAdded(address token);

  address public tokenManager;
  address public bridgeMediator;
  address public exchange;
  address public supplierManager;
  address public versionManager;

  modifier onlyBridgeMediator() {
    require(msg.sender == bridgeMediator, "caller is not a bridge mediator");
    _;
  }

  function setup(
    address _tokenManager,
    address _supplierManager,
    address _exchange,
    address _bridgeMediator,
    address _versionManager
  ) external onlyOwner returns (bool) {
    require(_exchange != address(0), "exchange not set");
    require(_tokenManager != address(0), "tokenManager not set");
    require(_bridgeMediator != address(0), "bridgeMediator not set");
    require(_versionManager != address(0), "versionManager not set");

    exchange = _exchange;
    supplierManager = _supplierManager;
    tokenManager = _tokenManager;
    bridgeMediator = _bridgeMediator;
    versionManager = _versionManager;
    emit Setup();

    return true;
  }

  function addToken(address tokenAddr)
    external
    onlyBridgeMediator
    returns (bool)
  {
    require(tokenAddr != address(0), "invalid token address");
    return _addToken(tokenAddr);
  }

  function registerSupplier(address supplier)
    external
    onlyBridgeMediator
    returns (address)
  {
    require(supplier != address(0), "invalid supplier address");
    return SupplierManager(supplierManager).registerSupplier(supplier);
  }

  function isRegistered(address supplier) external view returns (bool) {
    return SupplierManager(supplierManager).isRegistered(supplier);
  }

  function safeForSupplier(address supplier) external view returns (address) {
    return SupplierManager(supplierManager).safeForSupplier(supplier);
  }

  function _addToken(address tokenAddr) internal returns (bool) {
    require(
      Exchange(exchange).hasExchange(tokenAddr),
      "No exchange exists for token"
    );
    TokenManager(tokenManager).addPayableToken(tokenAddr);
    emit TokenAdded(tokenAddr);
    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
