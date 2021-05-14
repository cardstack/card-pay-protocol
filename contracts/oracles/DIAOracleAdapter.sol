pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@chainlink/contracts/src/v0.5/interfaces/AggregatorV3Interface.sol";
import "./IPriceOracle.sol";
import "./IDIAOracle.sol";
import "../core/Versionable.sol";

contract DIAOracleAdapter is Ownable, Versionable, IPriceOracle {
  using SafeMath for uint256;

  uint8 internal constant DECIMALS = 8;
  address internal oracle;
  string internal tokenSymbol;
  address internal daiUsdFeed;

  event DAIOracleSetup(
    address tokenUsdOracle,
    string tokenSymbol,
    address daiUsdFeed
  );

  function setup(
    address _oracle,
    string calldata _tokenSymbol,
    address _daiUsdFeed
  ) external onlyOwner {
    require(
      _oracle != address(0) && _daiUsdFeed != address(0),
      "oracle can't be zero address"
    );
    uint8 daiUsdDecimals = AggregatorV3Interface(_daiUsdFeed).decimals();
    require(daiUsdDecimals == DECIMALS, "feed decimals mismatch");

    oracle = _oracle;
    tokenSymbol = _tokenSymbol;
    daiUsdFeed = _daiUsdFeed;

    emit DAIOracleSetup(oracle, _tokenSymbol, _daiUsdFeed);
  }

  function decimals() external view returns (uint8) {
    return DECIMALS;
  }

  function description() external view returns (string memory) {
    return tokenSymbol;
  }

  function usdPrice() external view returns (uint256 price, uint256 updatedAt) {
    return priceForPair(string(abi.encodePacked(tokenSymbol, "/USD")));
  }

  function ethPrice() external view returns (uint256 price, uint256 updatedAt) {
    return priceForPair(string(abi.encodePacked(tokenSymbol, "/ETH")));
  }

  function daiPrice() external view returns (uint256 price, uint256 updatedAt) {
    (uint256 tokenUsdPrice, uint256 _updatedAt) =
      priceForPair(string(abi.encodePacked(tokenSymbol, "/USD")));
    (, int256 daiUsdPrice, , , ) =
      AggregatorV3Interface(daiUsdFeed).latestRoundData();
    // a quirk about exponents is that the result will be calculated in the type
    // of the base, so in order to prevent overflows you should use a base of
    // uint256
    uint256 ten = 10;
    price = (tokenUsdPrice.mul(ten**DECIMALS)).div(uint256(daiUsdPrice));
    updatedAt = _updatedAt;
  }

  function priceForPair(string memory pair)
    internal
    view
    returns (uint256 price, uint256 updatedAt)
  {
    require(oracle != address(0), "DIA oracle is not specified");
    (uint128 _price, uint128 _updatedAt) = IDIAOracle(oracle).getValue(pair);
    price = uint256(_price);
    updatedAt = uint256(_updatedAt);
  }
}
