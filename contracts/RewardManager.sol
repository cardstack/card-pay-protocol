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
    event RewardProgramCreated(address admin, address rewardProgramID);
    event RewardProgramRemoved(address rewardProgramID);
    event RewardProgramAdminUpdated(address newAdmin);
    event RewardProgramLocked(address rewardProgramID);
    event RewardSafeCreated(address owner, address rewardSafe);
    event RewardSafeTransferred();
    event RewardRuleAdded(string ruleDID);
    event RewardRuleRemoved(string ruleDID);
    event RewardeeRegistered(address rewardProgramID, address rewardee);

    // Constants
    address internal constant ZERO_ADDRESS = address(0);
    bytes4 public constant SWAP_OWNER = 0xe318b52b; //swapOwner(address,address,address)

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

    modifier onlyAdmin(address rewardProgramID) {
        require(
            _adminRewardProgram(rewardProgramID) == msg.sender,
            "caller must be admin of reward program"
        );
        _;
    }

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
        rewardSafe = createSafe(owners, 2);
        rewardSafes[rewardProgramID][prepaidCardOwner] = rewardSafe;
        emit RewardeeRegistered(rewardProgramID, prepaidCardOwner);
        emit RewardSafeCreated(prepaidCardOwner, rewardSafe);
        return rewardSafe;
    }

    function transferRewardSafe(
        address payable rewardSafe,
        address gasToken,
        address payable gasRecipient,
        bytes calldata previousOwnerSignature,
        bytes calldata data
    ) external {
        execTransaction(
            rewardSafe,
            rewardSafe,
            data,
            _addContractSignature(rewardSafe, previousOwnerSignature),
            gasToken,
            gasRecipient
        );
        emit RewardSafeTransferred();
    }

    // somehow using a private function gets rid of the callstack too deep error
    function execTransaction(
        address payable rewardSafe,
        address to,
        bytes memory data,
        bytes memory signatures,
        address _gasToken,
        address payable _gasRecipient
    ) private returns (bool) {
        require(
            GnosisSafe(rewardSafe).execTransaction(
                to,
                0,
                data,
                Enum.Operation.Call,
                0,
                0,
                0, //If there is no gas price, there will be no transfer to _gasRecipient
                _gasToken,
                _gasRecipient,
                signatures
            ),
            "safe transaction was reverted"
        );

        return true;
    }

    function getTransferRewardSafeData(
        address payable rewardSafe,
        address newOwner
    ) public view returns (bytes memory) {
        // Swap owner
        address previousOwner = getRewardSafeOwner(rewardSafe);
        return
            abi.encodeWithSelector(
                SWAP_OWNER,
                address(this),
                previousOwner,
                newOwner
            );
    }

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

    function getRewardSafeOwner(address payable rewardSafe)
        public
        view
        returns (address)
    {
        address[] memory owners = GnosisSafe(rewardSafe).getOwners();
        require(
            owners.length == 2,
            "unexpected number of owners for prepaid card"
        );
        return owners[0] == address(this) ? owners[1] : owners[0];
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

    function _getContractSignature()
        internal
        view
        returns (bytes memory contractSignature)
    {
        // Create signature
        contractSignature = new bytes(65);
        bytes memory encodeData = abi.encode(this, address(0));
        for (uint256 i = 1; i <= 64; i++) {
            contractSignature[64 - i] = encodeData[encodeData.length.sub(i)];
        }
        bytes1 v = 0x01;
        contractSignature[64] = v;
    }

    function _addContractSignature(
        address payable rewardSafe,
        bytes memory signature
    ) internal view returns (bytes memory signatures) {
        require(signature.length == 65, "Invalid signature!");

        address owner = getRewardSafeOwner(rewardSafe);
        bytes memory contractSignature = _getContractSignature();
        signatures = new bytes(130); // 2 x 65 bytes
        // Gnosis safe require signature must be sort by owner' address.
        if (address(this) > owner) {
            for (uint256 i = 0; i < signature.length; i++) {
                signatures[i] = signature[i];
            }
            for (uint256 i = 0; i < contractSignature.length; i++) {
                signatures[i.add(65)] = contractSignature[i];
            }
        } else {
            for (uint256 i = 0; i < contractSignature.length; i++) {
                signatures[i] = contractSignature[i];
            }
            for (uint256 i = 0; i < signature.length; i++) {
                signatures[i.add(65)] = signature[i];
            }
        }
    }
}
