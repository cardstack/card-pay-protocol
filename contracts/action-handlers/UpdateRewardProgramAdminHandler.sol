pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";
import "../core/Versionable.sol";
import "../PrepaidCardManager.sol";
import "../Exchange.sol";
import "../RewardManager.sol";
import "../VersionManager.sol";

contract UpdateRewardProgramAdminHandler is Ownable, Versionable {
  event Setup();
  event RewardProgramAdminUpdated(
    address prepaidCard,
    address rewardProgramID,
    address oldAdmin,
    address newAdmin
  );
  address public actionDispatcher;
  address public prepaidCardManager;
  address public exchangeAddress;
  address public tokenManagerAddress;
  address public rewardManagerAddress;
  address public versionManager;

  function setup(
    address _actionDispatcher,
    address _prepaidCardManager,
    address _exchangeAddress,
    address _tokenManagerAddress,
    address _rewardManagerAddress,
    address _versionManager
  ) external onlyOwner returns (bool) {
    require(_actionDispatcher != address(0), "actionDispatcher not set");
    require(_prepaidCardManager != address(0), "prepaidCardManager not set");
    require(_exchangeAddress != address(0), "exchangeAddress not set");
    require(_tokenManagerAddress != address(0), "tokenManagerAddress not set");
    require(
      _rewardManagerAddress != address(0),
      "rewardManagerAddress not set"
    );
    require(_versionManager != address(0), "versionManager not set");

    actionDispatcher = _actionDispatcher;
    prepaidCardManager = _prepaidCardManager;
    exchangeAddress = _exchangeAddress;
    tokenManagerAddress = _tokenManagerAddress;
    rewardManagerAddress = _rewardManagerAddress;
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   *
   * This sets a new admin for the reward program.
   *
   * See UpdateRewardProgramAdminHandler in README for more information.
   *
   * @param from the token sender (should be the action dispatcher)
   * @param data, encoded as (
   *  address prepaidCard,
   *  uint256 spendAmount (not used here),
   *  bytes actionData, encoded as: (
   *    address rewardProgramID,
   *    address newAdmin
   *    )
   *  )
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

    (address rewardProgramID, address newAdmin) = abi.decode(
      actionData,
      (address, address)
    );

    require(
      RewardManager(rewardManagerAddress).isRewardProgram(rewardProgramID),
      "reward program does not exist"
    );
    address prepaidCardOwner = PrepaidCardManager(prepaidCardManager)
      .getPrepaidCardOwner(prepaidCard);

    //replacement for onlyAdmin
    require(
      RewardManager(rewardManagerAddress).rewardProgramAdmins(
        rewardProgramID
      ) == prepaidCardOwner,
      "can only be called by reward program admin"
    );

    RewardManager(rewardManagerAddress).updateAdmin(rewardProgramID, newAdmin);
    PrepaidCardManager(
      prepaidCardManager
    ).setPrepaidCardUsed(prepaidCard);
    emit RewardProgramAdminUpdated(
      prepaidCard,
      rewardProgramID,
      prepaidCardOwner,
      newAdmin
    );
    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
