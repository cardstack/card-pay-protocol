pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "../core/Versionable.sol";
import "../token/IERC677.sol";
import "../PrepaidCardManager.sol";

contract SplitPrepaidCardHandler is Ownable, Versionable {
  address public actionDispatcher;
  address public prepaidCardManagerAddress;

  event Setup();
  event SplitPrepaidCard(
    address prepaidCard,
    uint256[] issuingTokenAmounts,
    uint256[] spendAmounts,
    address issuingToken,
    address issuer,
    string customizationDID
  );

  function setup(address _actionDispatcher, address _prepaidCardManager)
    external
    onlyOwner
    returns (bool)
  {
    actionDispatcher = _actionDispatcher;
    prepaidCardManagerAddress = _prepaidCardManager;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   * handle using a prepaid card to create more prepaid cards
   * @param from the token sender (should be the revenue pool)
   * @param amount the amount of tokens being transferred
   * @param data the data encoded as (address prepaidCard, uint256 spendAmount, bytes actionData)
   * where actionData is encoded as (uint256[] issuingTokenAmounts, uint256[] spendAmounts, string customizatoinDID)
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
    (address payable prepaidCard, , bytes memory actionData) =
      abi.decode(data, (address, uint256, bytes));
    (
      uint256[] memory issuingTokenAmounts,
      uint256[] memory spendAmounts,
      string memory customizationDID
    ) = abi.decode(actionData, (uint256[], uint256[], string));
    PrepaidCardManager prepaidCardMgr =
      PrepaidCardManager(prepaidCardManagerAddress);
    address owner = prepaidCardMgr.getPrepaidCardOwner(prepaidCard);
    address issuer = prepaidCardMgr.getPrepaidCardIssuer(prepaidCard);
    require(issuer == owner, "only issuer can split card");
    require(
      issuingTokenAmounts.length == spendAmounts.length,
      "the amount arrays have differing lengths"
    );
    prepaidCardMgr.setPrepaidCardUsedForSplit(prepaidCard);
    IERC677(msg.sender).transferAndCall(
      prepaidCardManagerAddress,
      amount,
      abi.encode(owner, issuingTokenAmounts, spendAmounts, customizationDID)
    );
    emit SplitPrepaidCard(
      prepaidCard,
      issuingTokenAmounts,
      spendAmounts,
      msg.sender,
      issuer,
      customizationDID
    );
  }
}
