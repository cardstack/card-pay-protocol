pragma solidity 0.5.17;

interface IPrepaidCardManager {
  struct CardDetail {
    address issuer;
    address issueToken;
  }
  event CreatePrepaidCard(
    address issuer,
    address card,
    address token,
    uint256 amount
  );

  function onTokenTransfer(
    address from,
    uint256 amount,
    bytes calldata data
  ) external returns (bool);

  function payForMerchant(
    address payable prepaidCardAddr,
    address payableTokenAddr,
    address merchantSafe,
    uint256 paymentAmount,
    bytes calldata customerSignatures
  ) external returns (bool);

  function sellCard(
    address payable prepaidCardAddr,
    address depotAddr,
    address buyer,
    bytes calldata sellerSignature
  ) external payable returns (bool);

  function splitCard(
    address payable prepaidCardAddr,
    address depotAddr,
    address issueToken,
    uint256[] calldata subCardAmounts,
    bytes calldata issuerSignatures
  ) external payable returns (bool);
}
