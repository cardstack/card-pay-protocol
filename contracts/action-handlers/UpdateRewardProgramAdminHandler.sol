pragma solidity ^0.7.6;

import "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";

import "../core/Ownable.sol";
import "../core/Versionable.sol";
import "../PrepaidCardManager.sol";
import "../Exchange.sol";
import "../RewardManager.sol";
import "../VersionManager.sol";

contract UpdateRewardProgramAdminHandler is Ownable, Versionable {
  using SafeMathUpgradeable for uint256;
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
    actionDispatcher = _actionDispatcher;
    prepaidCardManager = _prepaidCardManager;
    exchangeAddress = _exchangeAddress;
    tokenManagerAddress = _tokenManagerAddress;
    rewardManagerAddress = _rewardManagerAddress;
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  function onTokenTransfer(
    address payable from,
    uint256 amount, // solhint-disable-line no-unused-vars
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
