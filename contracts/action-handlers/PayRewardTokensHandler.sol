pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "../RewardManager.sol";
import "../Exchange.sol";
import "../core/Versionable.sol";

contract PayRewardTokensHandler is Ownable, Versionable {
  using SafeMath for uint256;
  event Setup();
  event RewardTokensPaid(
    address prepaidCard,
    address issuingToken,
    uint256 issuingTokenAmount,
    address rewardProgramID
  );
  address public actionDispatcher;
  address public exchangeAddress;
  address public tokenManagerAddress;
  address public rewardPoolAddress;

  function setup(
    address _actionDispatcher,
    address _exchangeAddress,
    address _tokenManagerAddress,
    address _rewardPoolAddress
  ) external onlyOwner returns (bool) {
    actionDispatcher = _actionDispatcher;
    exchangeAddress = _exchangeAddress;
    tokenManagerAddress = _tokenManagerAddress;
    rewardPoolAddress = _rewardPoolAddress;
    emit Setup();
    return true;
  }

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

    address rewardProgramID = abi.decode(actionData, (address));

    IERC677(msg.sender).transferAndCall(rewardPoolAddress, amount, actionData);
    emit RewardTokensPaid(prepaidCard, msg.sender, amount, rewardProgramID);
    return true;
  }
}
