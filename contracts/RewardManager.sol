pragma solidity ^0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";

import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./ActionDispatcher.sol";

contract RewardManager is Ownable, Versionable, Safe {
    //Using
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeMath for uint256;

    //Events
    event Setup();
    event RewardProgramCreated(address rewardProgramID, address admin);
    event RewardProgramRemoved(address rewardProgramID);
    event RewardProgramAdminUpdated(address rewardProgramID, address newAdmin);
    event RewardProgramLocked(address rewardProgramID);
    event RewardSafeTransferred(address oldOwner, address newOwner);
    event RewardRuleAdded(address rewardProgramID, string ruleDID);
    event RewardRuleRemoved(address rewardProgramID, string ruleDID);
    event RewardeeRegistered(
        address rewardProgramID,
        address rewardee,
        address rewardSafe
    );

    // Constants
    address internal constant ZERO_ADDRESS = address(0);

    //State Variables
    address public actionDispatcher;
    uint256 public rewardeeRegistrationFeeInSPEND;
    uint256 public rewardProgramRegistrationFeeInSPEND;
    address payable public rewardFeeReceiver; // will receive receive all fees
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
    mapping(address => mapping(string => Rule)) public rule; //reward program id <> rule did <> Rule
    mapping(address => bool) public rewardProgramLocked; //reward program id <> locked

    modifier onlyHandlers() {
        require(
            ActionDispatcher(actionDispatcher).isHandler(msg.sender),
            "caller is not a registered action handler"
        );
        _;
    }

    //External Mutating Functions
    function setup(
        address _actionDispatcher,
        address _gsMasterCopy,
        address _gsProxyFactory,
        address payable _rewardFeeReceiver,
        uint256 _rewardeeRegistrationFeeInSPEND,
        uint256 _rewardProgramRegistrationFeeInSPEND
    ) external onlyOwner {
        require(
            _rewardFeeReceiver != ZERO_ADDRESS,
            "rewardFeeReceiver not set"
        );
        require(
            _rewardeeRegistrationFeeInSPEND > 0,
            "rewardeeRegistrationFeeInSPEND is not set"
        );
        require(
            _rewardProgramRegistrationFeeInSPEND > 0,
            "rewardProgramRegistrationFeeInSPEND is not set"
        );
        actionDispatcher = _actionDispatcher;
        Safe.setup(_gsMasterCopy, _gsProxyFactory);
        rewardFeeReceiver = _rewardFeeReceiver;
        rewardeeRegistrationFeeInSPEND = _rewardeeRegistrationFeeInSPEND;
        rewardProgramRegistrationFeeInSPEND = _rewardProgramRegistrationFeeInSPEND;
        emit Setup();
    }

    function registerRewardProgram(address admin, address rewardProgramID)
        external
        onlyHandlers
    {
        require(
            !isRewardProgram(rewardProgramID),
            "reward program already registered"
        );
        rewardProgramIDs.add(rewardProgramID);
        rewardProgramAdmins[rewardProgramID] = admin;
        rewardPrograms[rewardProgramID] = RewardProgram(admin, false);
        emit RewardProgramCreated(rewardProgramID, admin);
    }

    function removeRewardProgram(address rewardProgramID) external onlyOwner {
        rewardProgramIDs.remove(rewardProgramID);
        delete rewardProgramAdmins[rewardProgramID];
        emit RewardProgramRemoved(rewardProgramID);
    }

    function updateAdmin(address rewardProgramID, address newAdmin)
        external
        onlyHandlers
    {
        rewardProgramAdmins[rewardProgramID] = newAdmin;
        emit RewardProgramAdminUpdated(rewardProgramID, newAdmin);
    }

    function addRewardRule(
        address rewardProgramID,
        string calldata ruleDID,
        string calldata tallyRuleDID,
        string calldata benefitDID
    ) external onlyHandlers {
        rule[rewardProgramID][ruleDID] = Rule(tallyRuleDID, benefitDID);
        emit RewardRuleAdded(rewardProgramID, ruleDID);
    }

    function removeRewardRule(address rewardProgramID, string calldata ruleDID)
        external
        onlyHandlers
    {
        delete rule[rewardProgramID][ruleDID];
        emit RewardRuleRemoved(rewardProgramID, ruleDID);
    }

    function lockRewardProgram(address rewardProgramID) external onlyHandlers {
        rewardPrograms[rewardProgramID].locked = true;
        emit RewardProgramLocked(rewardProgramID);
    }

    function registerRewardee(address rewardProgramID, address prepaidCardOwner)
        external
        onlyHandlers
        returns (address)
    {
        // creation of reward safe
        // - enable person to claim rewards
        address rewardSafe = rewardSafes[rewardProgramID][prepaidCardOwner];
        require(
            rewardSafe == ZERO_ADDRESS,
            "prepaid card owner already registered for reward program"
        );
        address[] memory owners = new address[](2);

        owners[0] = address(this);
        owners[1] = prepaidCardOwner;
        rewardSafe = createSafe(owners[1]);
        rewardSafes[rewardProgramID][prepaidCardOwner] = rewardSafe;
        emit RewardeeRegistered(rewardProgramID, prepaidCardOwner, rewardSafe);
        return rewardSafe;
    }

    //Public View Functions
    function getRewardSafeOwner(address payable rewardSafe)
        public
        view
        returns (address)
    {
        address[] memory owners = GnosisSafe(rewardSafe).getOwners();
        return owners[0];
    }

    function isRewardProgram(address rewardProgramID)
        public
        view
        returns (bool)
    {
        return rewardProgramIDs.contains(rewardProgramID);
    }

    function isValidRewardSafe(
        address payable rewardSafe,
        address rewardProgramID
    ) public view returns (bool) {
        address rewardSafeOwner = getRewardSafeOwner(rewardSafe);
        return rewardSafe == rewardSafes[rewardProgramID][rewardSafeOwner];
    }

    // External View Functions
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
