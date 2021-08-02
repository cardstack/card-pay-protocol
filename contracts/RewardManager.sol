pragma solidity ^0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";

import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./ActionDispatcher.sol";

contract RewardManager is Ownable, Versionable, Safe {
    //Using
    using EnumerableSet for EnumerableSet.AddressSet;

    //Events
    event Setup();
    event RewardProgramCreated(address admin, address rewardProgramID);
    event RewardProgramRemoved(address rewardProgramID);
    event RewardProgramAdminUpdated(address newAdmin);
    event RewardProgramLocked(address rewardProgramID);
    event RewardSafeTransferred(address from, address to);
    event RewardRuleAdded(string ruleDID);
    event RewardRuleRemoved(string ruleDID);

    //State Variables
    address internal constant ZERO_ADDRESS = address(0);
    address public actionDispatcher;
    uint256 public rewardeeRegistrationFeeInSPEND;
    address payable public rewardFeeReceiver; // will receive rewardeeRegistrationFeeInSPEND
    struct RewardProgram {
        address admin;
        bool locked;
    }

    struct Rule {
        string tallyRuleDID;
        string benefitDID;
    }

    EnumerableSet.AddressSet rewardProgramIDs;
    mapping(address => address) public rewardProgramAdmins; //reward program id <> reward program admins
    mapping(address => RewardProgram) public rewardPrograms; //reward program ids
    mapping(address => mapping(address => address)) public rewardSafes; //reward program id <> prepaid card owner <> reward safes
    mapping(address => address) public rewardees;
    mapping(address => mapping(string => Rule)) public rule; //reward program id <> rule did <> Rule
    mapping(address => bool) public rewardProgramLocked; //reward program id <> locked

    modifier onlyAdmin(address rewardProgramID) {
        require(
            _adminRewardProgram(rewardProgramID) == msg.sender,
            "caller must be admin of reward program"
        );
        _;
    }

    //External Mutating Functions
    function setup(
        address _actionDispatcher,
        address _gsMasterCopy,
        address _gsProxyFactory,
        address payable _rewardFeeReceiver,
        uint256 _rewardeeRegistrationFeeInSPEND
    ) external onlyOwner {
        require(
            _rewardFeeReceiver != ZERO_ADDRESS,
            "rewardFeeReceiver not set"
        );
        require(
            _rewardeeRegistrationFeeInSPEND > 0,
            "rewardeeRegistrationFeeInSPEND is not set"
        );
        actionDispatcher = _actionDispatcher;
        Safe.setup(_gsMasterCopy, _gsProxyFactory);
        rewardFeeReceiver = _rewardFeeReceiver;
        rewardeeRegistrationFeeInSPEND = _rewardeeRegistrationFeeInSPEND;
        emit Setup();
    }

    function registerRewardProgram(address admin, address rewardProgramID)
        external
    {
        require(
            !_isRewardProgram(rewardProgramID),
            "reward program already registered"
        );
        rewardProgramIDs.add(rewardProgramID);
        rewardProgramAdmins[rewardProgramID] = admin;
        rewardPrograms[rewardProgramID] = RewardProgram(msg.sender, false);
        emit RewardProgramCreated(admin, rewardProgramID);
    }

    function removeRewardProgram(address rewardProgramID)
        external
        onlyAdmin(rewardProgramID)
    {
        rewardProgramIDs.remove(rewardProgramID);
        emit RewardProgramRemoved(rewardProgramID);
    }

    function updateAdmin(address rewardProgramID, address admin)
        external
        onlyAdmin(rewardProgramID)
    {
        rewardProgramAdmins[rewardProgramID] = admin;
        emit RewardProgramAdminUpdated(admin);
    }

    function addRewardRule(
        address rewardProgramID,
        string calldata ruleDID,
        string calldata tallyRuleDID,
        string calldata benefitDID
    ) external onlyAdmin(rewardProgramID) {
        rule[rewardProgramID][ruleDID] = Rule(tallyRuleDID, benefitDID);
        emit RewardRuleAdded(ruleDID);
    }

    function removeRewardRule(address rewardProgramID, string calldata ruleDID)
        external
        onlyAdmin(rewardProgramID)
    {
        delete rule[rewardProgramID][ruleDID];
        emit RewardRuleRemoved(ruleDID);
    }

    function lockRewardProgram(address rewardProgramID)
        external
        onlyAdmin(rewardProgramID)
    {
        rewardPrograms[rewardProgramID].locked = true;
        emit RewardProgramLocked(rewardProgramID);
    }

    function register(address rewardProgramID, address prepaidCardOwner)
        external
        returns (address)
    {
        // creation of reward safe
        // - enable person to claim rewards
        address rewardSafe = rewardSafes[rewardProgramID][prepaidCardOwner];
        require(
            rewardSafe == ZERO_ADDRESS,
            "prepaid card owner already registered for reward program"
        );
        rewardSafe = createSafe(prepaidCardOwner);
        rewardSafes[rewardProgramID][prepaidCardOwner] = rewardSafe;
        return rewardSafe;
    }

    // function transferRewardSafe(address RewardSafe) external {}

    // External View Functions
    function isLocked(address rewardProgramID) external view returns (bool) {
        if (rewardPrograms[rewardProgramID].locked) {
            return true;
        } else {
            return false;
        }
    }

    function hasRule(address rewardProgramID, string calldata ruleDID)
        external
        view
        returns (bool)
    {
        if (_equalRule(rule[rewardProgramID][ruleDID], Rule("", ""))) {
            return false;
        } else {
            return true;
        }
    }

    function isRewardProgram(address rewardProgramID)
        external
        view
        returns (bool)
    {
        return _isRewardProgram(rewardProgramID);
    }

    function adminRewardProgram(address rewardProgramID)
        external
        view
        returns (address)
    {
        return _adminRewardProgram(rewardProgramID);
    }

    function hasRewardSafe(address rewardProgramID, address prepaidCardOwner)
        external
        view
        returns (bool)
    {
        if (rewardSafes[rewardProgramID][prepaidCardOwner] == ZERO_ADDRESS) {
            return false;
        } else {
            return true;
        }
    }

    //Internal View Functions
    function _adminRewardProgram(address rewardProgramID)
        internal
        view
        returns (address)
    {
        return rewardProgramAdmins[rewardProgramID];
    }

    function _isRewardProgram(address rewardProgramID)
        internal
        view
        returns (bool)
    {
        return rewardProgramIDs.contains(rewardProgramID);
    }

    function _equalRule(Rule memory rule1, Rule memory rule2)
        internal
        pure
        returns (bool)
    {
        // Used to check if the Rule Struct has all default values
        return
            (
                keccak256(
                    abi.encodePacked(rule1.tallyRuleDID, rule1.benefitDID)
                )
            ) ==
            keccak256(abi.encodePacked(rule2.tallyRuleDID, rule2.benefitDID));
    }
}
