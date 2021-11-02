pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "../core/Versionable.sol";
import "../PrepaidCardManager.sol";
import "../Exchange.sol";
import "../RewardManager.sol";
import "../VersionManager.sol";

contract AddRewardRuleHandler is Ownable, Versionable {
  using SafeMath for uint256;
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

    (
      address rewardProgramID,
      bytes memory blob
    ) = abi.decode(actionData, (address, bytes));

    address prepaidCardOwner = PrepaidCardManager(prepaidCardManager)
      .getPrepaidCardOwner(prepaidCard);

    require(
      RewardManager(rewardManagerAddress).rewardProgramAdmins(
        rewardProgramID
      ) == prepaidCardOwner,
      "can only be called by reward program admin"
    );
    RewardManager(rewardManagerAddress).addRewardRule(
      rewardProgramID,
      blob
    );
    emit RewardRuleAdded(
      prepaidCard,
      rewardProgramID,
      blob
    );
    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
