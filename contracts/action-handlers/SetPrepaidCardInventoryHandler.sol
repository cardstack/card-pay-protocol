pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "../core/Versionable.sol";
import "../token/IERC677.sol";
import "../PrepaidCardManager.sol";
import "../TokenManager.sol";
import "../IPrepaidCardMarket.sol";
import "hardhat/console.sol";

contract SetPrepaidCardInventoryHandler is Ownable, Versionable {
  address public actionDispatcher;
  address public prepaidCardManagerAddress;
  address public tokenManagerAddress;

  event Setup();

  function setup(
    address _actionDispatcher,
    address _prepaidCardManager,
    address _tokenManagerAddress
  ) external onlyOwner returns (bool) {
    actionDispatcher = _actionDispatcher;
    prepaidCardManagerAddress = _prepaidCardManager;
    tokenManagerAddress = _tokenManagerAddress;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   * handle setting prepaid cards in market inventory
   * @param from the token sender (should be the revenue pool)
   * @param amount the amount of tokens being transferred
   * @param data the data encoded as (address prepaidCard, uint256 spendAmount, bytes actionData)
   * where actionData is encoded as (address prepaidCard, address marketAddress, bytes previousOwnerSignature)
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
    (address payable prepaidCard, , bytes memory actionData) =
      abi.decode(data, (address, uint256, bytes));
    (
      address prepaidCardForInventory,
      address marketAddress,
      bytes memory previousOwnerSignature
    ) = abi.decode(actionData, (address, address, bytes));
    require(marketAddress != address(0), "market address is required");
    PrepaidCardManager prepaidCardMgr =
      PrepaidCardManager(prepaidCardManagerAddress);
    address owner =
      prepaidCardMgr.getPrepaidCardOwner(
        address(uint160(prepaidCardForInventory))
      );
    address issuer =
      prepaidCardMgr.getPrepaidCardIssuer(prepaidCardForInventory);
    require(issuer == owner, "only issuer can set market inventory");
    prepaidCardMgr.setPrepaidCardUsed(prepaidCard);

    PrepaidCardManager(prepaidCardManagerAddress).transfer(
      address(uint160(prepaidCardForInventory)),
      marketAddress,
      previousOwnerSignature
    );

    IPrepaidCardMarket(marketAddress).setItem(issuer, prepaidCardForInventory);
  }
}
