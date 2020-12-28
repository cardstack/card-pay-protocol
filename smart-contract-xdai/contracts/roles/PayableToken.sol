pragma solidity ^0.5.17;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

contract PayableToken is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal payableTokens;

    address public tokenManager;

    function setTokenManager(address _tokenManager) internal {
        tokenManager = _tokenManager;
    }

    /**
     * @dev Throws if called by any account other than the payable token.
     */
    modifier onlyPayableToken() {
        require(
            payableTokens.contains(msg.sender),
            "Guard: Token is not support payable by contract."
        );
        _;
    }

    modifier verifyPayableToken(address _token) {
        require(
            payableTokens.contains(_token),
            "Guard: Token is not support payable by contract."
        );
        _;
    }

    modifier onlyTokenManager() {
        require(
            _msgSender() == tokenManager,
            "Guard: Action support only token manager"
        );
        _;
    }

    function addPayableToken(address _token)
        public
        onlyTokenManager
        returns (bool)
    {
        return _addPayableToken(_token);
    }

    function _addPayableToken(address _token) internal returns (bool) {
        payableTokens.add(_token);
        return true;
    }

    function removePayableToken(address _token)
        public
        onlyTokenManager
        returns (bool)
    {
        return _removePayableToken(_token);
    }

    function _removePayableToken(address _token) internal returns (bool) {
        payableTokens.remove(_token);
        return true;
    }

    function getTokens() public view returns (address[] memory) {
        return payableTokens.enumerate();
    }
}
