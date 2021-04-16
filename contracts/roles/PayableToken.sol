pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";

contract PayableToken is Ownable {
  using EnumerableSet for EnumerableSet.AddressSet;

  EnumerableSet.AddressSet internal payableTokens;
  address private _bridgeUtils;

  event PayableTokenAdded(address indexed token);
  event PayableTokenRemoved(address indexed token);
  event BridgeUtilsSet(address indexed bridgeUtils);

  /**
   * @dev Throws if called by any token contract not inside payable token list.
   */
  modifier isValidToken() {
    require(
      payableTokens.contains(_msgSender()),
      "calling token is unaccepted"
    );
    _;
  }

  modifier isValidTokenAddress(address _token) {
    require(payableTokens.contains(_token), "unaccepted token");
    _;
  }

  modifier onlyBridgeUtilsOrOwner() {
    require(isBridgeUtils() || isOwner(), "caller is not BridgeUtils");
    _;
  }

  function addPayableToken(address _token)
    public
    onlyBridgeUtilsOrOwner
    returns (bool)
  {
    return _addPayableToken(_token);
  }

  function removePayableToken(address _token) public onlyOwner returns (bool) {
    return _removePayableToken(_token);
  }

  function setBridgeUtils(address bridgeUtils) public onlyOwner returns (bool) {
    _bridgeUtils = bridgeUtils;
    emit BridgeUtilsSet(bridgeUtils);
  }

  function bridgeUtils() public view returns (address) {
    return _bridgeUtils;
  }

  function getTokens() public view returns (address[] memory) {
    return payableTokens.enumerate();
  }

  function isBridgeUtils() public view returns (bool) {
    return _msgSender() == _bridgeUtils;
  }

  function _addPayableToken(address _token) internal returns (bool) {
    payableTokens.add(_token);
    emit PayableTokenAdded(_token);
    return true;
  }

  function _removePayableToken(address _token) internal returns (bool) {
    payableTokens.remove(_token);
    emit PayableTokenRemoved(_token);
    return true;
  }
}
