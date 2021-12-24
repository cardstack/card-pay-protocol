pragma solidity ^0.7.6;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import "../core/Ownable.sol";
import "../MerchantManager.sol";
import "../RevenuePool.sol";
import "../Exchange.sol";
import "../core/Versionable.sol";
import "../TokenManager.sol";
import "../VersionManager.sol";

contract RegisterMerchantHandler is Ownable, Versionable {
  using SafeMathUpgradeable for uint256;

  event MerchantRegistrationFee(
    address card,
    address issuingToken,
    uint256 issuingTokenAmount,
    uint256 spendAmount
  );
  event Setup();

  address public merchantManager;
  address public revenuePoolAddress;
  address public exchangeAddress;
  address public actionDispatcher;
  address public prepaidCardManager;
  address public tokenManagerAddress;
  address public versionManager;

  function setup(
    address _actionDispatcher,
    address _merchantManager,
    address _prepaidCardManager,
    address _revenuePoolAddress,
    address _exchangeAddress,
    address _tokenManagerAddress,
    address _versionManager
  ) external onlyOwner returns (bool) {
    actionDispatcher = _actionDispatcher;
    revenuePoolAddress = _revenuePoolAddress;
    prepaidCardManager = _prepaidCardManager;
    merchantManager = _merchantManager;
    exchangeAddress = _exchangeAddress;
    tokenManagerAddress = _tokenManagerAddress;
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   * handle a merchant registration
   * @param from the token sender (should be the action dispatcher)
   * @param amount the amount of tokens being transferred
   * @param data the data encoded as (address prepaidCard, uint256 spendAmount, bytes actionData)
   * where actionData is encoded as (address infoDID)
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
    RevenuePool revenuePool = RevenuePool(revenuePoolAddress);
    address issuingToken = msg.sender;
    (address payable prepaidCard, , bytes memory actionData) = abi.decode(
      data,
      (address, uint256, bytes)
    );
    uint256 merchantRegistrationFeeInToken = Exchange(exchangeAddress)
      .convertFromSpend(
        issuingToken,
        revenuePool.merchantRegistrationFeeInSPEND()
      );
    require(
      amount >= merchantRegistrationFeeInToken,
      "Insufficient funds for merchant registration"
    );

    string memory infoDID = abi.decode(actionData, (string));
    PrepaidCardManager(prepaidCardManager).setPrepaidCardUsed(prepaidCard);
    // The merchantFeeReceiver is a trusted address
    IERC677(issuingToken).transfer(
      revenuePool.merchantFeeReceiver(),
      merchantRegistrationFeeInToken
    );
    uint256 refund = amount.sub(merchantRegistrationFeeInToken);
    if (refund > 0) {
      // from is a trusted contract address (gnosis safe)
      IERC677(issuingToken).transfer(prepaidCard, refund);
    }

    address merchant = PrepaidCardManager(revenuePool.prepaidCardManager())
      .getPrepaidCardOwner(prepaidCard);
    emit MerchantRegistrationFee(
      prepaidCard,
      issuingToken,
      amount,
      revenuePool.merchantRegistrationFeeInSPEND()
    );
    MerchantManager(merchantManager).registerMerchant(merchant, infoDID);
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
