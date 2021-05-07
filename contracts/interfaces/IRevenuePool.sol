pragma solidity 0.5.17;

interface IRevenuePool {
  event MerchantClaim(
    address merchantSafe,
    address payableToken,
    uint256 amount
  );

  event CustomerPayment(
    address prepaidCardArr,
    address merchantSafe,
    address payableToken,
    uint256 amount
  );

  /**
   * @dev onTokenTransfer(ERC677) - call when token receive pool.
   * we will exchange receive token to SPEND token and mint it for the wallet of merchant.
   * @param from - who transfer token (should from prepaid card).
   * @param amount - number token customer pay for merchant.
   * @param data - merchantSafe in encode format.
   */
  function onTokenTransfer(
    address from,
    uint256 amount,
    bytes calldata data
  ) external returns (bool);

  /**
   * @dev merchant claim token to their wallets, only tally account can call this method
   * @param merchantSafe address of merchant safe
   * @param payableToken address of payable token
   * @param amount amount in payable token
   */
  function claimToken(
    address merchantSafe,
    address payableToken,
    uint256 amount
  ) external returns (bool);
}
