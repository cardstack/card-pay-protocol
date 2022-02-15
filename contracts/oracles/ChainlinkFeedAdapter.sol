pragma solidity ^0.8.9;
pragma abicoder v1;

import "@chainlink/contracts/src/v0.5/interfaces/AggregatorV3Interface.sol";

import "../core/Ownable.sol";
import "./IPriceOracle.sol";
import "../core/Versionable.sol";
import "../VersionManager.sol";

contract ChainlinkFeedAdapter is Ownable, Versionable, IPriceOracle {
  address public tokenUsdFeed;
  address public ethUsdFeed;
  address public daiUsdFeed;
  address public versionManager;
  bool public canSnapToUSD;
  uint256 public snapThreshold;

  event ChainlinkFeedSetup(
    address tokenUsdFeed,
    address ethUsdFeed,
    address daiUsdFeed
  );

  function setup(
    address _tokenUsdFeed,
    address _ethUsdFeed,
    address _daiUsdFeed,
    bool _canSnapToUSD,
    uint256 _snapThreshold, // this is a percentage expressed as a numerator of 10 ^ decimals() as the denominator
    address _versionManager
  ) external onlyOwner {
    require(
      _tokenUsdFeed != address(0) &&
        _ethUsdFeed != address(0) &&
        _daiUsdFeed != address(0),
      "feed can't be zero address"
    );
    uint8 tokenUsdDecimals = AggregatorV3Interface(_tokenUsdFeed).decimals();
    uint8 ethUsdDecimals = AggregatorV3Interface(_ethUsdFeed).decimals();
    uint8 daiUsdDecimals = AggregatorV3Interface(_daiUsdFeed).decimals();
    require(tokenUsdDecimals == ethUsdDecimals, "feed decimals mismatch");
    require(tokenUsdDecimals == daiUsdDecimals, "feed decimals mismatch");

    tokenUsdFeed = _tokenUsdFeed;
    ethUsdFeed = _ethUsdFeed;
    daiUsdFeed = _daiUsdFeed;
    canSnapToUSD = _canSnapToUSD;
    snapThreshold = _snapThreshold;
    versionManager = _versionManager;
    emit ChainlinkFeedSetup(_tokenUsdFeed, _ethUsdFeed, _daiUsdFeed);
  }

  function decimals() public view override returns (uint8) {
    return AggregatorV3Interface(tokenUsdFeed).decimals();
  }

  function description() external view override returns (string memory) {
    return AggregatorV3Interface(tokenUsdFeed).description();
  }

  function usdDelta() public view returns (uint256) {
    (, int256 _price, , , ) = AggregatorV3Interface(tokenUsdFeed)
      .latestRoundData();
    uint256 currentUsdPrice = uint256(_price);
    uint256 _oneDollar = oneDollar();
    return
      currentUsdPrice >= _oneDollar
        ? currentUsdPrice - _oneDollar
        : _oneDollar - currentUsdPrice;
  }

  function isSnappedToUSD() public view returns (bool) {
    if (!canSnapToUSD) return false;
    return usdDelta() <= snapThreshold;
  }

  function usdPrice()
    public
    view
    override
    returns (uint256 price, uint256 updatedAt)
  {
    require(tokenUsdFeed != address(0), "feed address is not specified");
    (, int256 _price, , uint256 _updatedAt, ) = AggregatorV3Interface(
      tokenUsdFeed
    ).latestRoundData();
    updatedAt = _updatedAt;
    if (isSnappedToUSD()) {
      price = oneDollar();
    } else {
      price = uint256(_price);
    }
  }

  function ethPrice()
    external
    view
    override
    returns (uint256 price, uint256 updatedAt)
  {
    require(
      tokenUsdFeed != address(0) && ethUsdFeed != address(0),
      "feed address is not specified"
    );
    AggregatorV3Interface tokenUsd = AggregatorV3Interface(tokenUsdFeed);
    AggregatorV3Interface ethUsd = AggregatorV3Interface(ethUsdFeed);
    uint8 tokenUsdDecimals = tokenUsd.decimals();

    (uint256 usdTokenPrice, uint256 _updatedAt) = usdPrice();
    (, int256 ethUsdPrice, , , ) = ethUsd.latestRoundData();
    // a quirk about exponents is that the result will be calculated in the type
    // of the base, so in order to prevent overflows you should use a base of
    // uint256
    uint256 ten = 10;
    price = (usdTokenPrice * (ten**tokenUsdDecimals)) / uint256(ethUsdPrice);
    updatedAt = _updatedAt;
  }

  function daiPrice()
    external
    view
    override
    returns (uint256 price, uint256 updatedAt)
  {
    require(
      tokenUsdFeed != address(0) && daiUsdFeed != address(0),
      "feed address is not specified"
    );
    uint256 ten = 10;
    AggregatorV3Interface daiUsd = AggregatorV3Interface(daiUsdFeed);
    // the token is question actually is DAI, so the price is just 1 DAI
    if (tokenUsdFeed == daiUsdFeed) {
      (, , , uint256 _updatedAtDai, ) = daiUsd.latestRoundData();
      uint8 daiDecimals = daiUsd.decimals();
      price = ten**daiDecimals;
      updatedAt = _updatedAtDai;
      return (price, updatedAt);
    }

    AggregatorV3Interface tokenUsd = AggregatorV3Interface(tokenUsdFeed);
    uint8 tokenUsdDecimals = tokenUsd.decimals();

    // In this case we are converting thru USD to get the DAI rate for this token,
    // use the live rate, not the snapped rate.
    (, int256 tokenUsdPrice, , uint256 _updatedAt, ) = tokenUsd
      .latestRoundData();
    (, int256 daiUsdPrice, , , ) = daiUsd.latestRoundData();
    price =
      (uint256(tokenUsdPrice) * (ten**tokenUsdDecimals)) /
      uint256(daiUsdPrice);
    updatedAt = _updatedAt;
  }

  function oneDollar() internal view returns (uint256) {
    // a quirk about exponents is that the result will be calculated in the type
    // of the base, so in order to prevent overflows you should use a base of
    // uint256
    uint256 ten = 10;
    return ten**decimals();
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
