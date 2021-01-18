pragma solidity 0.5.17;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../roles/PayableToken.sol";

/// @dev get amount when exchange from token `X` to SPEND and else.
contract Exchange is PayableToken {

    using SafeMath for uint256;
    
    /**
     * @dev query exchange rate of payable token and SPEND
     * @param _token address of payableToken
     * @return exchange rate
     * TODO: should use current exchange rate from chainlink
     */
    function exchangeRateOf(address _token) internal pure returns (uint256) {
        return 100;
    }

    /**
     * @dev convert amount in SPEND to amount in payableToken
     * @param payableTokenAddr address of payableToken
     * @param amount amount in SPEND
     * TODO: should use current exchange rate from chainlink
     */
    function convertToPayableToken(address payableTokenAddr, uint256 amount)
        public
        view
        returns (uint256)
    {
        return amount.mul(10**16);
    }

    /**
     * @dev convert amount in payableToken to amount in SPEND
     * @param payableTokenAddr address of payableToken
     * @param amount amount in payableToken
     * @return amount
    * TODO:  should use current exchange rate from chainlink
     */
    function convertToSpend(address payableTokenAddr, uint256 amount)
        public
        view
        returns (uint256)
    {   
        return amount.div(10**16);
    }

}
