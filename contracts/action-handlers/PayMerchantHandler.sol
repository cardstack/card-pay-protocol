pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../core/Ownable.sol";
import "../PrepaidCardManager.sol";
import "../RevenuePool.sol";
import "../MerchantManager.sol";
import "../core/Versionable.sol";
import "../TokenManager.sol";
import "../VersionManager.sol";

contract PayMerchantHandler is Ownable, Versionable {
  using SafeERC20Upgradeable for IERC677;

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
  address public tokenManagerAddress;
  address public versionManager;

  function setup(
    address _actionDispatcher,
    address _merchantManager,
    address _prepaidCardManager,
    address _revenuePoolAddress,
    address _spendTokenAddress,
    address _tokenManagerAddress,
    address _versionManager
  ) external onlyOwner returns (bool) {
    require(_actionDispatcher != address(0), "actionDispatcher not set");
    require(_merchantManager != address(0), "merchantManager not set");
    require(_prepaidCardManager != address(0), "prepaidCardManager not set");
    require(_revenuePoolAddress != address(0), "revenuePoolAddress not set");
    require(_spendTokenAddress != address(0), "spendTokenAddress not set");
    require(_tokenManagerAddress != address(0), "tokenManagerAddress not set");
    require(_versionManager != address(0), "versionManager not set");

    merchantManager = _merchantManager;
    actionDispatcher = _actionDispatcher;
    revenuePoolAddress = _revenuePoolAddress;
    spendTokenAddress = _spendTokenAddress;
    prepaidCardManager = _prepaidCardManager;
    tokenManagerAddress = _tokenManagerAddress;
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   *
   * When tokens are sent to this contract, this function handles a prepaid card
   * payment to a merchant, which includes minting SPEND into the merchant's safe,
   * collecting protocol fees, and increasing the merchant's unclaimed revenue
   * by the issuing token amount minus fees.
   *
   * See PayMerchantHandler in README for more information.
   *
   * @param from the token sender (should be the action dispatcher)
   * @param amount the amount of tokens being transferred
   * @param data encoded as: (
   *  address prepaidCard,
   *  uint256 spendAmount,
   *  bytes actionData, encoded as: (
   *    address merchantSafe
   *  )
   * )
   */
  function onTokenTransfer(
    address payable from,
    uint256 amount,
    bytes calldata data
  ) external returns (bool) {
    require(
      TokenManager(tokenManagerAddress).isValidToken(msg.sender),
      "calling token is unaccepted"
    );
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
    uint256 merchantFee = revenuePool.merchantFeePercentage() > 0
      ? (amount * (revenuePool.merchantFeePercentage())) /
        (ten**revenuePool.merchantFeeDecimals())
      : 0;
    uint256 merchantProceeds = amount - merchantFee;
    PrepaidCardManager(prepaidCardManager).setPrepaidCardUsed(prepaidCard);
    revenuePool.addToMerchantBalance(
      merchantSafe,
      msg.sender, // issuing token
      merchantProceeds
    );

    ISPEND(spendTokenAddress).mint(merchantSafe, spendAmount);

    // The merchantFeeReceiver is a trusted address
    IERC677(msg.sender).safeTransfer(
      revenuePool.merchantFeeReceiver(),
      merchantFee
    );
    IERC677(msg.sender).safeTransfer(revenuePoolAddress, merchantProceeds);

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

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
