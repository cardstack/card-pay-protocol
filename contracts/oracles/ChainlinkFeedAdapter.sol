pragma solidity 0.5.17;

import "@chainlink/contracts/src/v0.5/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "./IPriceOracle.sol";

contract ChainlinkFeedAdapter is Ownable, IPriceOracle {
  using SafeMath for uint256;
  address internal tokenUsdFeed;
  address internal usdEthFeed;

  event ChainlinkFeedSetup(address tokenUsdFeed, address usdEthFeed);

  function setup(address _tokenUsdFeed, address _usdEthFeed) public onlyOwner {
    require(
      _tokenUsdFeed != address(0) && _usdEthFeed != address(0),
      "feed can't be zero address"
    );
    uint8 tokenUsdDecimals = AggregatorV3Interface(_tokenUsdFeed).decimals();
    uint8 usdEthDecimals = AggregatorV3Interface(_usdEthFeed).decimals();
    require(tokenUsdDecimals == usdEthDecimals, "feed decimals mismatch");

    tokenUsdFeed = _tokenUsdFeed;
    usdEthFeed = _usdEthFeed;
    emit ChainlinkFeedSetup(_tokenUsdFeed, _usdEthFeed);
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
      tokenUsdFeed != address(0) && usdEthFeed != address(0),
      "feed address is not specified"
    );
    AggregatorV3Interface tokenUsd = AggregatorV3Interface(tokenUsdFeed);
    AggregatorV3Interface usdEth = AggregatorV3Interface(usdEthFeed);
    uint8 tokenUsdDecimals = tokenUsd.decimals();

    (, int256 tokenUsdPrice, , uint256 _updatedAt, ) =
      tokenUsd.latestRoundData();
    (, int256 ethUsdPrice, , , ) = usdEth.latestRoundData();
    // a quirk about exponents is that the result will be calculated in the type
    // of the base, so in order to prevent overflows you should use a base of
    // uint256
    uint256 ten = 10;
    price = (uint256(tokenUsdPrice).mul(ten**tokenUsdDecimals)).div(
      uint256(ethUsdPrice)
    );
    updatedAt = _updatedAt;
  }
}
