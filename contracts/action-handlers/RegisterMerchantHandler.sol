pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "../RevenuePool.sol";
import "../Exchange.sol";
import "../core/Versionable.sol";

contract RegisterMerchantHandler is Ownable, Versionable {
  using SafeMath for uint256;

  event MerchantRegistrationFee(
    address card,
    address issuingToken,
    uint256 issuingTokenAmount,
    uint256 spendAmount
  );

  address public revenuePoolAddress;
  address public exchangeAddress;

  function setup(address _revenuePoolAddress, address _exchangeAddress)
    external
    onlyOwner
    returns (bool)
  {
    revenuePoolAddress = _revenuePoolAddress;
    exchangeAddress = _exchangeAddress;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   * handle a merchant registration
   * @param from the token sender (should be the revenue pool)
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
      from == revenuePoolAddress,
      "can only accept tokens from revenue pool"
    );
    RevenuePool revenuePool = RevenuePool(revenuePoolAddress);
    address issuingToken = msg.sender;
    (address payable prepaidCard, , bytes memory actionData) =
      abi.decode(data, (address, uint256, bytes));
    uint256 merchantRegistrationFeeInToken =
      Exchange(exchangeAddress).convertFromSpend(
        issuingToken,
        revenuePool.merchantRegistrationFeeInSPEND()
      );
    require(
      amount >= merchantRegistrationFeeInToken,
      "Insufficient funds for merchant registration"
    );

    string memory infoDID = abi.decode(actionData, (string));
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

    address merchant =
      PrepaidCardManager(revenuePool.prepaidCardManager()).getPrepaidCardOwner(
        prepaidCard
      );
    emit MerchantRegistrationFee(
      prepaidCard,
      issuingToken,
      amount,
      revenuePool.merchantRegistrationFeeInSPEND()
    );
    revenuePool.addMerchant(merchant, infoDID);
  }
}
