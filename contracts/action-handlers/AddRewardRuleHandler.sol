pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "../core/Versionable.sol";
import "../PrepaidCardManager.sol";
import "../Exchange.sol";
import "../RewardManager.sol";

contract AddRewardRuleHandler is Ownable, Versionable {
    using SafeMath for uint256;
    event Setup();
    event RewardRuleAdded(
        address prepaidCard,
        address rewardProgramID,
        string ruleDID,
        string tallyRuleDID,
        string benefitRuleDID
    );

    address public actionDispatcher;
    address public prepaidCardManager;
    address public exchangeAddress;
    address public tokenManagerAddress;
    address public rewardManagerAddress;

    function setup(
        address _actionDispatcher,
        address _prepaidCardManager,
        address _exchangeAddress,
        address _tokenManagerAddress,
        address _rewardManagerAddress
    ) external onlyOwner returns (bool) {
        actionDispatcher = _actionDispatcher;
        prepaidCardManager = _prepaidCardManager;
        exchangeAddress = _exchangeAddress;
        tokenManagerAddress = _tokenManagerAddress;
        rewardManagerAddress = _rewardManagerAddress;
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
        (address payable prepaidCard, , bytes memory actionData) =
            abi.decode(data, (address, uint256, bytes));

        (
            address rewardProgramID,
            string memory ruleDID,
            string memory tallyRuleDID,
            string memory benefitDID
        ) = abi.decode(actionData, (address, string, string, string));

        address prepaidCardOwner =
            PrepaidCardManager(prepaidCardManager).getPrepaidCardOwner(
                prepaidCard
            );

        //replacement for onlyAdmin
        require(
            RewardManager(rewardManagerAddress).rewardProgramAdmins(
                rewardProgramID
            ) == prepaidCardOwner,
            "can only be called by reward program admin"
        );
        RewardManager(rewardManagerAddress).addRewardRule(
            rewardProgramID,
            ruleDID,
            tallyRuleDID,
            benefitDID
        );
        emit RewardRuleAdded(
            prepaidCard,
            rewardProgramID,
            ruleDID,
            tallyRuleDID,
            benefitDID
        );
        return true;
    }
}
