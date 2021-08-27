pragma solidity 0.5.17;

interface IPrepaidCardMarket {
  function setItem(address issuer, address prepaidCard) external returns (bool);

  function removeItems(address issuer, address[] calldata prepaidCards)
    external
    returns (bool);

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
}
