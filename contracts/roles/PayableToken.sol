pragma solidity 0.5.17;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";


contract PayableToken is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal payableTokens;

    /**
     * @dev Throws if called by any token contract not inside payable token list.
     */
    modifier isValidToken() {
        require(
            payableTokens.contains(_msgSender()),
            "unaccepted token"
        );
        _;
    }

    modifier isValidTokenAddress(address _token) {
        require(
            payableTokens.contains(_token),
            "unaccepted token"
        );
        _;
    }

    function addPayableToken(address _token) public returns (bool) {
        return _addPayableToken(_token);
    }

    function removePayableToken(address _token)
        public
        onlyOwner
        returns (bool)
    {
        return _removePayableToken(_token);
    }

    function getTokens() public view returns (address[] memory) {
        return payableTokens.enumerate();
    }

    function _addPayableToken(address _token) internal returns (bool) {
        payableTokens.add(_token);
        return true;
    }

    function _removePayableToken(address _token) internal returns (bool) {
        payableTokens.remove(_token);
        return true;
    }


}
