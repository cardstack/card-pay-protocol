pragma solidity 0.5.17;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

contract PayableToken is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal payableTokens;

    /**
     * @dev Throws if called by any account other than the admin.
     */
    modifier onlyPayableToken() {
        require(
            payableTokens.contains(_msgSender()),
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

    function addPayableToken(address _token) public onlyOwner returns (bool) {
        return _addPayableToken(_token);
    }

    function _addPayableToken(address _token) internal returns (bool) {
        payableTokens.add(_token);
        return true;
    }

    function removePayableToken(address _token)
        public
        onlyOwner
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
