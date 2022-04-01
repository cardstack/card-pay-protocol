pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";
import "../core/Versionable.sol";
import "../PrepaidCardManager.sol";
import "../Exchange.sol";
import "../RewardManager.sol";
import "../VersionManager.sol";

contract AddRewardRuleHandler is Ownable, Versionable {
  event Setup();
  event RewardRuleAdded(
    address prepaidCard,
    address rewardProgramID,
    bytes blob
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
   * This adds the reward rule to the reward manager.
   *
   * See AddRewardRuleHandler in README for more information.
   *
   * @param from the token sender (should be the action dispatcher)
   * @param data encoded as: (
   *  address prepaidCard,
   *  uint256 ???,
   *  bytes actionData, encoded as: (
   *    address rewardProgramID,
   *    bytes blob (hex encoding of rule blob)
   *    )
   *  )
   */
  function onTokenTransfer(
    address payable from,
    uint256, // amount (we ignore it because this action doesn't require any tokens)
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

    (address rewardProgramID, bytes memory blob) = abi.decode(
      actionData,
      (address, bytes)
    );

    require(
      RewardManager(rewardManagerAddress).isRewardProgram(rewardProgramID),
      "reward program does not exist"
    );

    address prepaidCardOwner = PrepaidCardManager(prepaidCardManager)
      .getPrepaidCardOwner(prepaidCard);

    require(
      RewardManager(rewardManagerAddress).rewardProgramAdmins(
        rewardProgramID
      ) == prepaidCardOwner,
      "can only be called by reward program admin"
    );

    RewardManager(rewardManagerAddress).addRewardRule(rewardProgramID, blob);
    emit RewardRuleAdded(prepaidCard, rewardProgramID, blob);
    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
