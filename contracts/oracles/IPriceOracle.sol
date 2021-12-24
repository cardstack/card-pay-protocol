pragma solidity ^0.7.6;

interface IPriceOracle {
  function decimals() external view returns (uint8);

  function description() external view returns (string memory);

  function usdPrice() external view returns (uint256 price, uint256 updatedAt);

  function ethPrice() external view returns (uint256 price, uint256 updatedAt);

  function daiPrice() external view returns (uint256 price, uint256 updatedAt);
}
