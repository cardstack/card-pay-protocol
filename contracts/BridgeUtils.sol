pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
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
    return _addToken(tokenAddr);
  }

  function registerSupplier(address supplier)
    external
    onlyBridgeMediator
    returns (address)
  {
    return SupplierManager(supplierManager).registerSupplier(supplier);
  }

  function isRegistered(address supplier) public view returns (bool) {
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
