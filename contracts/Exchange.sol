pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";

import "./token/IERC677.sol";
import "./oracles/IPriceOracle.sol";
import "./core/Versionable.sol";
import "./VersionManager.sol";

contract Exchange is Ownable, Versionable {
  using SafeMath for uint256;

  event Setup();
  event ExchangeCreated(string indexed tokenSymbol, address feed);

  struct ExchangeInfo {
    bool exists;
    string tokenSymbol;
    address feed;
  }

  mapping(bytes32 => ExchangeInfo) public exchanges;
  uint256 public rateDriftPercentage; // decimals 8
  address public versionManager;

  /**
   * @dev set up revenue pool
   * @param _rateDriftPercentage the numberator of a decimals 8 fraction that
   * represents the percentage of how much a requested rate lock is allowed to
   * drift from the actual rate
   */
  function setup(uint256 _rateDriftPercentage, address _versionManager)
    external
    onlyOwner
  {
    rateDriftPercentage = _rateDriftPercentage;
    versionManager = _versionManager;
    emit Setup();
  }

  function createExchange(string calldata tokenSymbol, address feed)
    external
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
   * @dev query USD exchange rate of payable token
   * @param token address of payableToken
   * @return exchange rate
   */
  function exchangeRateOf(address token)
    public
    view
    returns (uint256 price, uint8 decimals)
  {
    require(hasExchange(token), "no exchange exists for token");
    ExchangeInfo memory exchange = exchanges[
      keccak256(bytes(IERC677(token).symbol()))
    ];
    IPriceOracle oracle = IPriceOracle(exchange.feed);
    decimals = oracle.decimals();
    (price, ) = oracle.usdPrice();
  }

  /**
   * @dev convert amount in token to amount in SPEND
   * @param token address of token
   * @param amount amount in token
   * @return amount
   */
  function convertToSpend(address token, uint256 amount)
    external
    view
    returns (uint256)
  {
    (uint256 usdRate, uint8 decimals) = exchangeRateOf(token);
    require(
      decimals == exchangeRateDecimals(),
      "unexpected decimals value for token price"
    );
    require(usdRate > 0, "exchange rate cannot be 0");
    return convertToSpendWithRate(token, amount, usdRate);
  }

  /**
   * @dev convert amount in token to amount in SPEND using the provided rate.
   * Note that the rate needs to use decimals 8.
   * @param token address of token
   * @param amount amount in token
   * @param usdRate the usd token rate in decimal 8
   * @return amount
   */
  function convertToSpendWithRate(
    address token,
    uint256 amount,
    uint256 usdRate
  ) public view returns (uint256) {
    require(usdRate > 0, "exchange rate cannot be 0");
    // SPEND is equivalent to USD cents, so we move the decimal point 2
    // places to the right after obtaining the USD value of the token amount
    uint8 spendDecimals = IERC677(token).decimals() +
      exchangeRateDecimals() -
      2;
    require(spendDecimals <= 30, "exponent overflow is likely");
    // a quirk about exponents is that the result will be calculated in the type
    // of the base, so in order to prevent overflows you should use a base of
    // uint256
    uint256 ten = 10;
    return (amount.mul(usdRate)).div(ten**spendDecimals);
  }

  /**
   * @dev convert amount in SPEND to the amount in token
   * @param token address of token
   * @param amount amount in SPEND
   * @return amount
   */
  function convertFromSpend(address token, uint256 amount)
    external
    view
    returns (uint256)
  {
    (uint256 price, uint8 decimals) = exchangeRateOf(token);
    require(
      decimals == exchangeRateDecimals(),
      "unexpected decimals value for token price"
    );
    return convertFromSpendWithRate(token, amount, price);
  }

  /**
   * @dev convert amount in SPEND to the amount in token using the
   * provided rate. Note that the rate needs to use decimals 8
   * @param token address of token
   * @param amount amount in SPEND
   * @param usdRate the token rate in decimal 8
   * @return amount
   */
  function convertFromSpendWithRate(
    address token,
    uint256 amount,
    uint256 usdRate
  ) public view returns (uint256) {
    require(usdRate > 0, "exchange rate cannot be 0");
    // SPEND is equivalent to USD cents, so we move the decimal point 2
    // places to the right after obtaining the USD value of the token amount
    uint8 spendDecimals = IERC677(token).decimals() +
      exchangeRateDecimals() -
      2;
    require(spendDecimals <= 30, "exponent overflow is likely");
    // a quirk about exponents is that the result will be calculated in the type
    // of the base, so in order to prevent overflows you should use a base of
    // uint256
    uint256 ten = 10;
    return (amount.mul(ten**spendDecimals)).div(usdRate);
  }

  /**
   * @dev concert amount from CARD to the specified token
   * @param token the address of the token you are converting to
   * @param amount in CARD that you are converting
   */
  function convertFromCARD(address token, uint256 amount)
    external
    view
    returns (uint256)
  {
    bytes32 cardKey = keccak256(bytes("CARD"));
    require(exchanges[cardKey].exists, "no exchange exists for CARD");
    require(hasExchange(token), "no exchange exists for token");

    // convert through USD to specified token
    IPriceOracle oracle = IPriceOracle(exchanges[cardKey].feed);
    uint8 cardExchangeDecimals = oracle.decimals();
    (uint256 cardUSDPrice, ) = oracle.usdPrice();
    uint256 rawUsdValue = amount.mul(cardUSDPrice);

    (uint256 tokenUSDPrice, uint8 tokenExchangeDecimals) = exchangeRateOf(
      token
    );
    uint256 ten = 10;
    return
      (rawUsdValue.mul(ten**tokenExchangeDecimals)).div(
        tokenUSDPrice.mul(ten**cardExchangeDecimals)
      );
  }

  /**
   * @dev determine whether the requested rate falls within the acceptable safety
   * margin
   * @param token the issuing token address
   * @param requestedRate the requested price of the issuing token in USD
   */
  function isAllowableRate(address token, uint256 requestedRate)
    external
    view
    returns (bool)
  {
    (uint256 actualRate, ) = exchangeRateOf(token);
    uint256 drift = actualRate > requestedRate
      ? actualRate.sub(requestedRate)
      : requestedRate.sub(actualRate);
    uint256 ten = 10;
    uint256 observedDriftPercentage = (drift.mul(ten**exchangeRateDecimals()))
      .div(actualRate);
    return observedDriftPercentage <= rateDriftPercentage;
  }

  function exchangeRateDecimals() public pure returns (uint8) {
    return 8;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
