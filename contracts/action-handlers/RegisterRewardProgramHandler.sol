pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";
import "../RewardManager.sol";
import "../Exchange.sol";
import "../core/Versionable.sol";
import "../VersionManager.sol";

contract RegisterRewardProgramHandler is Ownable, Versionable {
  event Setup();
  event RewardProgramRegistrationFee(
    address prepaidCard,
    address issuingToken,
    uint256 issuingTokenAmount,
    uint256 spendAmount,
    address admin,
    address rewardProgramID
  );
  address public actionDispatcher;
  address public exchangeAddress;
  address public tokenManagerAddress;
  address public rewardManagerAddress;
  address public versionManager;

  function setup(
    address _actionDispatcher,
    address _exchangeAddress,
    address _tokenManagerAddress,
    address _rewardManagerAddress,
    address _versionManager
  ) external onlyOwner returns (bool) {
    require(_actionDispatcher != address(0), "actionDispatcher not set");
    require(_exchangeAddress != address(0), "exchangeAddress not set");
    require(_tokenManagerAddress != address(0), "tokenManagerAddress not set");
    require(
      _rewardManagerAddress != address(0),
      "rewardManagerAddress not set"
    );
    require(_versionManager != address(0), "versionManager not set");

    actionDispatcher = _actionDispatcher;
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
   * When tokens are sent to this contract, it transfers the reward program registration fee
   * to the reward fee receiver, and refunds the amount in case it exceeds the fee.
   * Then it registers the reward program by adding it to the reward manager.
   *
   * See RegisterRewardProgramHandler in README for more information.
   *
   * @param from the token sender (should be the action dispatcher)
   * @param amount the amount of tokens being transferred
   * @param data encoded as: (
   *  address prepaidCard,
   *  uint256 spendAmount (not used here),
   *  bytes actionData, encoded as: (
   *    address admin,
   *    address rewardProgramID
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
    RewardManager rewardManager = RewardManager(rewardManagerAddress);
    uint256 rewardProgramRegistrationFeeInSPEND = rewardManager
      .rewardProgramRegistrationFeeInSPEND();

    (address payable prepaidCard, , bytes memory actionData) = abi.decode(
      data,
      (address, uint256, bytes)
    );

    (address admin, address rewardProgramID) = abi.decode(
      actionData,
      (address, address)
    );

    uint256 rewardProgramRegistrationFeeInToken = Exchange(exchangeAddress)
      .convertFromSpend(
        msg.sender, // issuing token address
        rewardProgramRegistrationFeeInSPEND
      );
    require(
      amount >= rewardProgramRegistrationFeeInToken,
      "Insufficient funds for reward program registration"
    );

    IERC677(msg.sender).transfer(
      rewardManager.rewardFeeReceiver(),
      rewardProgramRegistrationFeeInToken
    );

    uint256 refund = amount - rewardProgramRegistrationFeeInToken;
    if (refund > 0) {
      IERC677(msg.sender).transfer(prepaidCard, refund);
    }

    emit RewardProgramRegistrationFee(
      prepaidCard,
      msg.sender,
      amount,
      rewardProgramRegistrationFeeInSPEND,
      admin,
      rewardProgramID
    );
    RewardManager(rewardManagerAddress).registerRewardProgram(
      admin,
      rewardProgramID
    );
    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
