pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "../PrepaidCardManager.sol";
import "../RevenuePool.sol";
import "../MerchantManager.sol";
import "../core/Versionable.sol";

contract PayMerchantHandler is Ownable, Versionable {
  using SafeMath for uint256;

  event MerchantFeeCollected(
    address merchantSafe,
    address card,
    address issuingToken,
    uint256 amount
  );
  event CustomerPayment(
    address card,
    address merchantSafe,
    address issuingToken,
    uint256 issuingTokenAmount,
    uint256 spendAmount
  );
  event Setup();

  address public revenuePoolAddress;
  address public merchantManager;
  address public spendTokenAddress;
  address public actionDispatcher;
  address public prepaidCardManager;

  function setup(
    address _actionDispatcher,
    address _merchantManager,
    address _prepaidCardManager,
    address _revenuePoolAddress,
    address _spendTokenAddress
  ) external onlyOwner returns (bool) {
    merchantManager = _merchantManager;
    actionDispatcher = _actionDispatcher;
    revenuePoolAddress = _revenuePoolAddress;
    spendTokenAddress = _spendTokenAddress;
    prepaidCardManager = _prepaidCardManager;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   * handle a prepaid card payment to a merchant which includes minting
   * spend into the merchant's safe, collecting protocol fees, and increases the
   * merchants unclaimed revenue by the issuing token amount minus fees
   * @param from the token sender (should be the action dispatcher)
   * @param amount the amount of tokens being transferred
   * @param data the data encoded as (address prepaidCard, uint256 spendAmount, bytes actionData)
   * where actionData is encoded as (address merchantSafe)
   */
  function onTokenTransfer(
    address payable from,
    uint256 amount,
    bytes calldata data
  ) external returns (bool) {
    require(
      from == actionDispatcher,
      "can only accept tokens from action dispatcher"
    );
    (
      address payable prepaidCard,
      uint256 spendAmount,
      bytes memory actionData
    ) = abi.decode(data, (address, uint256, bytes));
    require(
      spendAmount >=
        PrepaidCardManager(prepaidCardManager).MINIMUM_MERCHANT_PAYMENT(),
      "payment too small"
    ); // protect against spamming contract with too low a price
    address merchantSafe = abi.decode(actionData, (address));
    RevenuePool revenuePool = RevenuePool(revenuePoolAddress);
    require(
      from == actionDispatcher,
      "can only accept tokens from action dispatcher"
    );
    require(
      MerchantManager(merchantManager).isMerchantSafe(merchantSafe),
      "Invalid merchant"
    );

    uint256 ten = 10;
    uint256 merchantFee =
      revenuePool.merchantFeePercentage() > 0
        ? (amount.mul(revenuePool.merchantFeePercentage())).div(
          ten**revenuePool.merchantFeeDecimals()
        )
        : 0;
    uint256 merchantProceeds = amount.sub(merchantFee);
    revenuePool.addToMerchantBalance(
      merchantSafe,
      msg.sender, // issuing token
      merchantProceeds
    );

    ISPEND(spendTokenAddress).mint(merchantSafe, spendAmount);

    // The merchantFeeReceiver is a trusted address
    IERC677(msg.sender).transfer(
      revenuePool.merchantFeeReceiver(),
      merchantFee
    );
    IERC677(msg.sender).transfer(revenuePoolAddress, merchantProceeds);

    emit CustomerPayment(
      prepaidCard,
      merchantSafe,
      msg.sender, // issuing token
      amount,
      spendAmount
    );
    emit MerchantFeeCollected(
      merchantSafe,
      prepaidCard,
      msg.sender, // issuing token
      merchantFee
    );
    return true;
  }
}
