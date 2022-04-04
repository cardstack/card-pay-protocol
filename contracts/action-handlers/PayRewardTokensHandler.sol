pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";
import "../TokenManager.sol";
import "../core/Versionable.sol";
import "../token/IERC677.sol";
import "../VersionManager.sol";
import "../libraries/SafeERC677.sol";

contract PayRewardTokensHandler is Ownable, Versionable {
  using SafeERC677 for IERC677;

  event Setup();
  event RewardTokensPaid(
    address prepaidCard,
    address issuingToken,
    uint256 issuingTokenAmount,
    address rewardProgramID
  );
  address public actionDispatcher;
  address public tokenManagerAddress;
  address public rewardPoolAddress;
  address public versionManager;

  function setup(
    address _actionDispatcher,
    address _tokenManagerAddress,
    address _rewardPoolAddress,
    address _versionManager
  ) external onlyOwner returns (bool) {
    actionDispatcher = _actionDispatcher;
    tokenManagerAddress = _tokenManagerAddress;
    rewardPoolAddress = _rewardPoolAddress;
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   *
   * When tokens are sent to this contract, it transfers them to the reward pool address.
   *
   * See PayRewardTokensHandler in README for more information.
   *
   * @param from the token sender (should be the action dispatcher)
   * @param amount amount in token
   * @param data encoded as: (
   *  address prepaidCard,
   *  uint256 spendAmount (not used here),
   *  bytes actionData, encoded as: (
   *    address rewardProgramID
   *   )
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
    (address payable prepaidCard, , bytes memory actionData) = abi.decode(
      data,
      (address, uint256, bytes)
    );

    address rewardProgramID = abi.decode(actionData, (address));

    IERC677(msg.sender).safeTransferAndCall(
      rewardPoolAddress,
      amount,
      actionData
    );
    emit RewardTokensPaid(prepaidCard, msg.sender, amount, rewardProgramID);
    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
