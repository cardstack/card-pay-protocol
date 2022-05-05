pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";
import "../core/Versionable.sol";
import "../token/IERC677.sol";
import "../PrepaidCardManager.sol";
import "../TokenManager.sol";
import "../PrepaidCardMarket.sol";
import "../VersionManager.sol";

contract RemovePrepaidCardInventoryHandler is Ownable, Versionable {
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
    require(_actionDispatcher != address(0), "actionDispatcher not set");
    require(_prepaidCardManager != address(0), "prepaidCardManager not set");
    require(_tokenManagerAddress != address(0), "tokenManagerAddress not set");
    require(_versionManager != address(0), "versionManager not set");

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
   * This handles the removal of a prepaid card from the inventory.
   *
   * See RemovePrepaidCardInventoryHandler in README for more information.
   *
   * @param from the token sender (should be the revenue pool)
   * @param data encoded as:
   *  address prepaidCard,
   *  uint256 spendAmount,
   *  bytes actionData, encoded as:
   *    address[] prepaidCards,
   *    address marketAddress
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
    (address[] memory prepaidCards, address marketAddress) = abi.decode(
      actionData,
      (address[], address)
    );
    require(marketAddress != address(0), "market address is required");

    PrepaidCardManager prepaidCardMgr = PrepaidCardManager(
      prepaidCardManagerAddress
    );
    require(prepaidCards.length > 0, "no prepaid cards specified");

    address owner = prepaidCardMgr.getPrepaidCardOwner(prepaidCard);
    for (uint256 i = 0; i < prepaidCards.length; i++) {
      require(
        prepaidCardMgr.getPrepaidCardIssuer(prepaidCards[i]) == owner,
        "only issuer can remove market inventory"
      );
    }

    prepaidCardMgr.setPrepaidCardUsed(prepaidCard);
    return PrepaidCardMarket(marketAddress).removeItems(owner, prepaidCards);
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
