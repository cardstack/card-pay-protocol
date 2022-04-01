pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";
import "../core/Versionable.sol";
import "../token/IERC677.sol";
import "../PrepaidCardManager.sol";
import "../TokenManager.sol";
import "../IPrepaidCardMarket.sol";
import "../VersionManager.sol";

contract SetPrepaidCardAskHandler is Ownable, Versionable {
  address public actionDispatcher;
  address public prepaidCardManagerAddress;
  address public tokenManagerAddress;
  address public versionManager;

  event Setup();

  function setup(
    address _actionDispatcher,
    address _prepaidCardManager,
    address _tokenManagerAddress,
    address _versionManager
  ) external onlyOwner returns (bool) {
    actionDispatcher = _actionDispatcher;
    prepaidCardManagerAddress = _prepaidCardManager;
    tokenManagerAddress = _tokenManagerAddress;
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   *
   * This handles setting the ask price for a SKU for the prepaid card.
   *
   * See SetPrepaidCardAskHandler in README for more information.
   *
   * @param from the token sender (should be the revenue pool)
   * @param data encoded as: (
   *  address prepaidCard,
   *  uint256 spendAmount,
   *  bytes actionData, encoded as: (
   *    bytes32 sku,
   *    uint256 askPrice,
   *    address marketAddress
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
    require(amount == 0, "amount must be 0");

    (address payable prepaidCard, , bytes memory actionData) = abi.decode(
      data,
      (address, uint256, bytes)
    );
    (bytes32 sku, uint256 askPrice, address marketAddress) = abi.decode(
      actionData,
      (bytes32, uint256, address)
    );
    require(marketAddress != address(0), "market address is required");

    PrepaidCardManager prepaidCardMgr = PrepaidCardManager(
      prepaidCardManagerAddress
    );
    IPrepaidCardMarket prepaidCardMarket = IPrepaidCardMarket(marketAddress);
    address owner = prepaidCardMgr.getPrepaidCardOwner(prepaidCard);
    (address issuer, , , ) = prepaidCardMarket.getSkuInfo(sku);
    require(issuer == owner, "only issuer can set market inventory");

    prepaidCardMgr.setPrepaidCardUsed(prepaidCard);
    return prepaidCardMarket.setAsk(issuer, sku, askPrice);
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
