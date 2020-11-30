pragma solidity ^0.5.17;
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev get amount when exchange from token `X` to SPEND and else.
contract Exchange {
    using SafeMath for uint256;
    
    /**
     * @dev query exchange rate of payable token and SPEND
     * @param _token address of payableToken
     * @return exchange rate
     */
    function exchangeRateOf(address _token) internal pure returns (uint256) {
        // TODO: using current exchange rate from chainlink
        return 100;
    }

    /**
     * @dev convert amount in SPEND to amount in payableToken
     * we use `payableToken` have 2 decimals now, so the rate come 1 vs 1
     * @param payableTokenAddr address of payableToken
     * @param amount amount in SPEND
     */
    function convertToPayableToken(address payableTokenAddr, uint256 amount)
        internal
        pure
        returns (uint256)
    {
        return amount;
    }

    /**
     * @dev convert amount in payableToken to amount in SPEND
     * we use `payableToken` have 2 decimals now, so the rate come 1 vs 1
     * @param payableTokenAddr address of payableToken
     * @param amount amount in payableToken
     * @return amount
     */
    function convertToSpend(address payableTokenAddr, uint256 amount)
        internal
        pure
        returns (uint256)
    {   
        return amount;
    }

}
