pragma solidity ^0.8.9;
pragma abicoder v1;

interface IPrepaidCardMarket {
  // mapping
  function asks(bytes32) external view returns (uint256);

  // property
  function paused() external view returns (bool);

  function getQuantity(bytes32 sku) external view returns (uint256);

  function setAsk(
    address issuer,
    bytes32 sku,
    uint256 askPrice
  ) external returns (bool);

  function provisionPrepaidCard(address customer, bytes32 sku)
    external
    returns (bool);

  function getSkuInfo(bytes32 sku)
    external
    view
    returns (
      address issuer,
      address issuingToken,
      uint256 faceValue,
      string memory customizationDID
    );

  function getSKU(
    address issuer,
    address token,
    uint256 faceValue,
    string memory customizationDID
  ) external view returns (bytes32);
}
