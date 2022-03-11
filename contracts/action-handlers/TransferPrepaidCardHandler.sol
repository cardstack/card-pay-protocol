pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Versionable.sol";
import "../core/Ownable.sol";
import "../PrepaidCardManager.sol";
import "../TokenManager.sol";
import "../VersionManager.sol";

contract TransferPrepaidCardHandler is Ownable, Versionable {
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
   * handle transferring a prepaid card
   * @param from the token sender (should be the revenue pool)
   * //param amount the amount of tokens being transferred
   * @param data the data encoded as (address prepaidCard, uint256 spendAmount, bytes actionData)
   * where actionData is encoded as (address newOwner, bytes previousOwnerSignature)
   */
  function onTokenTransfer(
    address payable from,
    uint256, /* amount */
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
    (address payable prepaidCard, , bytes memory actionData) = abi.decode(
      data,
      (address, uint256, bytes)
    );
    (address newOwner, bytes memory previousOwnerSignature) = abi.decode(
      actionData,
      (address, bytes)
    );
    return
      PrepaidCardManager(prepaidCardManagerAddress).transfer(
        prepaidCard,
        newOwner,
        previousOwnerSignature
      );
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
