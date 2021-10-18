pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "../core/Versionable.sol";
import "../PrepaidCardManager.sol";
import "../Exchange.sol";
import "../RewardManager.sol";

contract RegisterRewardeeHandler is Ownable, Versionable {
    using SafeMath for uint256;
    event Setup();
    event RewardeeRegistrationFee(
        address prepaidCard,
        address issuingToken,
        uint256 issuingTokenAmount,
        uint256 spendAmount,
        address rewardProgramID
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
        address issuingToken = msg.sender;
        uint256 rewardeeRegistrationFeeInSpend =
            rewardManager.rewardeeRegistrationFeeInSPEND();

        (address payable prepaidCard, , bytes memory actionData) =
            abi.decode(data, (address, uint256, bytes));

        address rewardProgramID = abi.decode(actionData, (address));

        uint256 rewardeeRegistrationFeeInToken =
            Exchange(exchangeAddress).convertFromSpend(
                issuingToken,
                rewardeeRegistrationFeeInSpend
            );
        require(
            amount >= rewardeeRegistrationFeeInToken,
            "Insufficient funds for merchant registration"
        );

        IERC677(msg.sender).transfer(
            rewardManager.rewardFeeReceiver(),
            rewardeeRegistrationFeeInToken
        );

        uint256 refund = amount.sub(rewardeeRegistrationFeeInToken);
        if (refund > 0) {
            IERC677(issuingToken).transfer(prepaidCard, refund);
        }

        address prepaidCardOwner =
            PrepaidCardManager(prepaidCardManager).getPrepaidCardOwner(
                prepaidCard
            );

        emit RewardeeRegistrationFee(
            prepaidCard,
            issuingToken,
            amount,
            rewardeeRegistrationFeeInSpend,
            rewardProgramID
        );
        address rewardSafe = RewardManager(rewardManagerAddress).registerRewardee(
            rewardProgramID,
            prepaidCardOwner
        );
        return true;
    }
}
