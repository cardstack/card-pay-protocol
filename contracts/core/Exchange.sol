pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
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
     // solhint-disable-next-line no-unused-vars
    function exchangeRateOf(address _token) public pure returns (uint256) {
        // this is the number of USD cents per token
        return 100;
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
        pure
        returns (uint256)
    {
        uint256 weiAmount = 1 ether;
        return amount.div((weiAmount).div(exchangeRateOf(payableTokenAddr)));
    }
}
