pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "../core/Versionable.sol";
import "../PrepaidCardManager.sol";

contract TransferPrepaidCardHandler is Ownable, Versionable {
  address public actionDispatcher;
  address public prepaidCardManagerAddress;

  event Setup();

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
   * handle transferring a prepaid card
   * @param from the token sender (should be the revenue pool)
   * @param amount the amount of tokens being transferred
   * @param data the data encoded as (address prepaidCard, uint256 spendAmount, bytes actionData)
   * where actionData is encoded as (address newOwner, bytes previousOwnerSignature)
   */
  function onTokenTransfer(
    address payable from,
    uint256 amount, // solhint-disable-line no-unused-vars
    bytes calldata data
  ) external returns (bool) {
    require(
      from == actionDispatcher,
      "can only accept tokens from action dispatcher"
    );
    (address payable prepaidCard, , bytes memory actionData) =
      abi.decode(data, (address, uint256, bytes));
    (address newOwner, bytes memory previousOwnerSignature) =
      abi.decode(actionData, (address, bytes));
    PrepaidCardManager(prepaidCardManagerAddress).transfer(
      prepaidCard,
      newOwner,
      previousOwnerSignature
    );
  }
}
