pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@chainlink/contracts/src/v0.5/interfaces/AggregatorV3Interface.sol";

import "../token/IERC677.sol";
import "../roles/PayableToken.sol";

contract Exchange is Ownable, PayableToken {
  using SafeMath for uint256;
  event ExchangeCreated(string indexed tokenSymbol, address feed);

  struct ExchangeInfo {
    bool exists;
    string tokenSymbol;
    address feed;
  }

  mapping(bytes32 => ExchangeInfo) public exchanges;

  function createExchange(string memory tokenSymbol, address feed)
    public
    onlyOwner
  {
    bytes32 key = keccak256(bytes(tokenSymbol));
    exchanges[key].exists = true;
    exchanges[key].tokenSymbol = tokenSymbol;
    exchanges[key].feed = feed;
    emit ExchangeCreated(tokenSymbol, feed);
  }

  function hasExchange(address token) public view returns (bool) {
    bytes32 key = keccak256(bytes(IERC677(token).symbol()));
    return exchanges[key].exists;
  }

  /**
   * @dev query exchange rate of payable token
   * @param token address of payableToken
   * @return exchange rate
   */
  function exchangeRateOf(address token)
    public
    view
    returns (int256 price, uint8 decimals)
  {
    require(hasExchange(token), "No exchange exists for token");
    ExchangeInfo memory exchange =
      exchanges[keccak256(bytes(IERC677(token).symbol()))];
    AggregatorV3Interface feed = AggregatorV3Interface(exchange.feed);
    decimals = feed.decimals();
    (, price, , , ) = feed.latestRoundData();
  }

  /**
   * @dev convert amount in payableToken to amount in SPEND
   * @param payableTokenAddr address of payableToken
   * @param amount amount in payableToken
   * @return amount
   */
  function convertToSpend(address payableTokenAddr, uint256 amount)
    public
    view
    returns (uint256)
  {
    (int256 price, uint8 decimals) = exchangeRateOf(payableTokenAddr);
    require(price > 0, "exchange rate cannot be 0");
    // SPEND is equivalent to USD cents, so we move the decimal point 2
    // places to the right after obtaining the USD value of the token amount
    uint8 spendDecimals = IERC677(payableTokenAddr).decimals() + decimals - 2;
    require(spendDecimals <= 30, "exponent overflow is likely");
    // a quirk about exponents is that the result will be calculated in the type
    // of the base, so in order to prevent overflows you should use a base of
    // uint256
    uint256 ten = 10;
    return (amount.mul(uint256(price))).div(ten**spendDecimals);
  }
}
