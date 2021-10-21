pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./TokenManager.sol";
import "./Exchange.sol";
import "./VersionManager.sol";

contract SupplierManager is Ownable, Versionable, Safe {
  event Setup();

  event SupplierSafeCreated(address supplier, address safe);
  event SupplierInfoDIDUpdated(address supplier, string infoDID);

  struct Supplier {
    bool registered;
    address safe;
    string infoDID;
  }

  mapping(address => Supplier) public suppliers;
  mapping(address => address) public safes;
  address public bridgeUtils;
  address public versionManager;

  modifier onlySupplierSafe() {
    require(safes[msg.sender] != address(0), "caller is not a supplier safe");
    _;
  }

  function setup(
    address _bridgeUtils,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address _versionManager
  ) external onlyOwner returns (bool) {
    bridgeUtils = _bridgeUtils;
    versionManager = _versionManager;
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
    emit Setup();

    return true;
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
    emit SupplierInfoDIDUpdated(supplier, infoDID);
    return true;
  }

  function registerSupplier(address supplier) external returns (address) {
    require(
      msg.sender == bridgeUtils || isOwner(),
      "caller is not BridgeUtils nor owner"
    );
    return _registerSupplier(supplier);
  }

  function isRegistered(address supplier) public view returns (bool) {
    return suppliers[supplier].registered;
  }

  function safeForSupplier(address supplier) public view returns (address) {
    if (!isRegistered(supplier)) {
      return address(0);
    }
    return suppliers[supplier].safe;
  }

  function _registerSupplier(address supplier) internal returns (address) {
    address safe = createSafe(supplier);
    suppliers[supplier].registered = true;
    suppliers[supplier].safe = safe;
    safes[safe] = supplier;

    emit SupplierSafeCreated(supplier, safe);
    return safe;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
