pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./core/Ownable.sol";
import "./core/Versionable.sol";
import "./VersionManager.sol";

contract TokenManager is Ownable, Versionable {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  EnumerableSetUpgradeable.AddressSet internal payableTokens;
  address public bridgeUtils;
  address public versionManager;

  event PayableTokenAdded(address indexed token);
  event PayableTokenRemoved(address indexed token);
  event BridgeUtilsSet(address indexed bridgeUtils);

  modifier onlyBridgeUtilsOrOwner() {
    require(
      isBridgeUtils() || (owner() == _msgSender()),
      "caller is not BridgeUtils"
    );
    _;
  }

  function setup(
    address _bridgeUtils,
    address[] calldata _payableTokens,
    address _versionManager
  ) external onlyOwner {
    bridgeUtils = _bridgeUtils;
    versionManager = _versionManager;
    emit BridgeUtilsSet(bridgeUtils);
    for (uint256 i = 0; i < _payableTokens.length; i++) {
      _addPayableToken(_payableTokens[i]);
    }
  }

  function addPayableToken(address _token)
    external
    onlyBridgeUtilsOrOwner
    returns (bool)
  {
    return _addPayableToken(_token);
  }

  function removePayableToken(address _token)
    external
    onlyOwner
    returns (bool)
  {
    return _removePayableToken(_token);
  }

  function getTokens() external view returns (address[] memory) {
    return payableTokens.values();
  }

  function isBridgeUtils() public view returns (bool) {
    return _msgSender() == bridgeUtils;
  }

  function isValidToken(address token) external view returns (bool) {
    return payableTokens.contains(token);
  }

  function _addPayableToken(address _token) internal returns (bool) {
    require(_token != address(0), "invalid token");

    payableTokens.add(_token);
    emit PayableTokenAdded(_token);
    return true;
  }

  function _removePayableToken(address _token) internal returns (bool) {
    require(payableTokens.contains(_token), "invalid token");
    payableTokens.remove(_token);
    emit PayableTokenRemoved(_token);
    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
