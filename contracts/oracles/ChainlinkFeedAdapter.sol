pragma solidity 0.5.17;

import "@chainlink/contracts/src/v0.5/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "./IPriceOracle.sol";
import "../core/Versionable.sol";

contract ChainlinkFeedAdapter is Ownable, Versionable, IPriceOracle {
  using SafeMath for uint256;
  address internal tokenUsdFeed;
  address internal ethUsdFeed;
  address internal daiUsdFeed;

  event ChainlinkFeedSetup(
    address tokenUsdFeed,
    address ethUsdFeed,
    address daiUsdFeed
  );

  function setup(
    address _tokenUsdFeed,
    address _ethUsdFeed,
    address _daiUsdFeed
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
    emit ChainlinkFeedSetup(_tokenUsdFeed, _ethUsdFeed, _daiUsdFeed);
  }

  function decimals() external view returns (uint8) {
    return AggregatorV3Interface(tokenUsdFeed).decimals();
  }

  function description() external view returns (string memory) {
    return AggregatorV3Interface(tokenUsdFeed).description();
  }

  function usdPrice() external view returns (uint256 price, uint256 updatedAt) {
    require(tokenUsdFeed != address(0), "feed address is not specified");
    (, int256 _price, , uint256 _updatedAt, ) =
      AggregatorV3Interface(tokenUsdFeed).latestRoundData();
    updatedAt = _updatedAt;
    price = uint256(_price);
  }

  function ethPrice() external view returns (uint256 price, uint256 updatedAt) {
    require(
      tokenUsdFeed != address(0) && ethUsdFeed != address(0),
      "feed address is not specified"
    );
    AggregatorV3Interface tokenUsd = AggregatorV3Interface(tokenUsdFeed);
    AggregatorV3Interface ethUsd = AggregatorV3Interface(ethUsdFeed);
    uint8 tokenUsdDecimals = tokenUsd.decimals();

    (, int256 tokenUsdPrice, , uint256 _updatedAt, ) =
      tokenUsd.latestRoundData();
    (, int256 ethUsdPrice, , , ) = ethUsd.latestRoundData();
    // a quirk about exponents is that the result will be calculated in the type
    // of the base, so in order to prevent overflows you should use a base of
    // uint256
    uint256 ten = 10;
    price = (uint256(tokenUsdPrice).mul(ten**tokenUsdDecimals)).div(
      uint256(ethUsdPrice)
    );
    updatedAt = _updatedAt;
  }

  function daiPrice() external view returns (uint256 price, uint256 updatedAt) {
    require(
      tokenUsdFeed != address(0) && daiUsdFeed != address(0),
      "feed address is not specified"
    );
    uint256 ten = 10;
    AggregatorV3Interface daiUsd = AggregatorV3Interface(daiUsdFeed);
    // the token is question actually is DAI, so the price is just 1 DAI
    if (tokenUsdFeed == daiUsdFeed) {
      (, , , uint256 _updatedAt, ) = daiUsd.latestRoundData();
      uint8 daiDecimals = daiUsd.decimals();
      price = ten**daiDecimals;
      updatedAt = _updatedAt;
    }

    AggregatorV3Interface tokenUsd = AggregatorV3Interface(tokenUsdFeed);
    uint8 tokenUsdDecimals = tokenUsd.decimals();

    (, int256 tokenUsdPrice, , uint256 _updatedAt, ) =
      tokenUsd.latestRoundData();
    (, int256 daiUsdPrice, , , ) = daiUsd.latestRoundData();
    price = (uint256(tokenUsdPrice).mul(ten**tokenUsdDecimals)).div(
      uint256(daiUsdPrice)
    );
    updatedAt = _updatedAt;
  }
}
