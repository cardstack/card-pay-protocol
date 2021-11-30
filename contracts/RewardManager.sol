pragma solidity ^0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@gnosis.pm/safe-contracts/contracts/interfaces/ISignatureValidator.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./ActionDispatcher.sol";
import "./VersionManager.sol";
import "./RewardSafeDelegateImplementation.sol";

contract RewardManager is Ownable, Versionable, Safe {
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeMath for uint256;

  event Setup();
  event RewardProgramCreated(address rewardProgramID, address admin);
  event RewardProgramRemoved(address rewardProgramID);
  event RewardProgramAdminUpdated(address rewardProgramID, address newAdmin);
  event RewardProgramLocked(address rewardProgramID);
  event RewardRuleAdded(address rewardProgramID, bytes blob);
  event RewardeeRegistered(
    address rewardProgramID,
    address rewardee,
    address rewardSafe
  );

  address internal constant ZERO_ADDRESS = address(0);
  bytes4 internal constant EIP1271_MAGIC_VALUE = 0x20c13b0b;
  uint256 internal _nonce;

  address public actionDispatcher;
  uint256 public rewardProgramRegistrationFeeInSPEND;
  address payable public rewardFeeReceiver; // will receive receive all fees
  address public governanceAdmin; // eoa with governance powers

  EnumerableSet.AddressSet internal rewardProgramIDs;
  EnumerableSet.AddressSet internal eip1271Contracts;
  mapping(address => EnumerableSet.AddressSet) internal rewardSafes; //reward program id <> reward safes
  mapping(address => bytes) public rule; //reward program id <> bytes
  mapping(address => address) public rewardProgramAdmins; //reward program id <> reward program admins
  mapping(address => bool) public rewardProgramLocked; //reward program id <> locked
  mapping(address => mapping(address => address)) public ownedRewardSafes; // EOA <> reward program id <> reward safe address
  mapping(address => address) public rewardProgramsForRewardSafes; // reward safe <> reward program id

  address public safeDelegateImplementation;

  address public versionManager;

  modifier onlyHandlers() {
    require(
      ActionDispatcher(actionDispatcher).isHandler(msg.sender),
      "caller is not a registered action handler"
    );
    _;
  }

  modifier onlyGovernanceAdmin() {
    require(msg.sender == governanceAdmin, "caller is not governance admin");
    _;
  }

  function initialize(address owner) public initializer {
    _nonce = 0;
    Ownable.initialize(owner);
  }

  function setup(
    address _actionDispatcher,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address payable _rewardFeeReceiver,
    uint256 _rewardProgramRegistrationFeeInSPEND,
    address[] calldata _eip1271Contracts,
    address _governanceAdmin,
    address _safeDelegateImplementation,
    address _versionManager
  ) external onlyOwner {
    require(_rewardFeeReceiver != ZERO_ADDRESS, "rewardFeeReceiver not set");
    require(
      _rewardProgramRegistrationFeeInSPEND > 0,
      "rewardProgramRegistrationFeeInSPEND is not set"
    );
    require(
      _safeDelegateImplementation != ZERO_ADDRESS,
      "safeDelegateImplementation not set"
    );
    actionDispatcher = _actionDispatcher;
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
    rewardFeeReceiver = _rewardFeeReceiver;
    rewardProgramRegistrationFeeInSPEND = _rewardProgramRegistrationFeeInSPEND;
    versionManager = _versionManager;
    governanceAdmin = _governanceAdmin;
    for (uint256 i = 0; i < _eip1271Contracts.length; i++) {
      eip1271Contracts.add(_eip1271Contracts[i]);
    }
    safeDelegateImplementation = _safeDelegateImplementation;
    emit Setup();
  }

  function getEip1271Contracts() public view returns (address[] memory) {
    return eip1271Contracts.enumerate();
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
    emit RewardProgramCreated(rewardProgramID, admin);
  }

  function removeRewardProgram(address rewardProgramID)
    external
    onlyGovernanceAdmin
  {
    rewardProgramIDs.remove(rewardProgramID);
    delete rewardProgramAdmins[rewardProgramID];
    delete rewardProgramLocked[rewardProgramID]; // equivalent to false
    delete rule[rewardProgramID]; // equivalent to false
    emit RewardProgramRemoved(rewardProgramID);
  }

  function updateAdmin(address rewardProgramID, address newAdmin)
    external
    onlyHandlers
  {
    rewardProgramAdmins[rewardProgramID] = newAdmin;
    emit RewardProgramAdminUpdated(rewardProgramID, newAdmin);
  }

  function addRewardRule(address rewardProgramID, bytes calldata blob)
    external
    onlyHandlers
  {
    rule[rewardProgramID] = blob;
    emit RewardRuleAdded(rewardProgramID, blob);
  }

  function lockRewardProgram(address rewardProgramID) external onlyHandlers {
    rewardProgramLocked[rewardProgramID] = !rewardProgramLocked[
      rewardProgramID
    ];
    emit RewardProgramLocked(rewardProgramID);
  }

  function registerRewardee(address rewardProgramID, address prepaidCardOwner)
    external
    onlyHandlers
    returns (address)
  {
    address[] memory owners = new address[](2);
    owners[0] = address(this);
    owners[1] = prepaidCardOwner;

    address existingSafe = ownedRewardSafes[prepaidCardOwner][rewardProgramID];
    require(existingSafe == address(0), "rewardee already registered");
    address rewardSafe = createSafe(owners, 2);
    rewardSafes[rewardProgramID].add(rewardSafe);
    ownedRewardSafes[prepaidCardOwner][rewardProgramID] = rewardSafe;
    rewardProgramsForRewardSafes[rewardSafe] = rewardProgramID;
    emit RewardeeRegistered(rewardProgramID, prepaidCardOwner, rewardSafe);
    return rewardSafe;
  }

  function willTransferRewardSafe(address newOwner) external {
    address oldOwner = getRewardSafeOwner(msg.sender);
    address rewardProgramID = rewardProgramsForRewardSafes[msg.sender];
    require(
      ownedRewardSafes[oldOwner][rewardProgramID] == msg.sender,
      "Only current owner can transfer"
    );
    ownedRewardSafes[oldOwner][rewardProgramID] = address(0);
    ownedRewardSafes[newOwner][rewardProgramID] = msg.sender;
  }

  function getRewardSafeOwner(address payable rewardSafe)
    public
    view
    returns (address)
  {
    address[] memory owners = GnosisSafe(rewardSafe).getOwners();
    require(owners.length == 2, "unexpected number of owners for reward safe");
    return owners[0] == address(this) ? owners[1] : owners[0];
  }

  function isRewardProgram(address rewardProgramID) public view returns (bool) {
    return rewardProgramIDs.contains(rewardProgramID);
  }

  function isValidRewardSafe(
    address payable rewardSafe,
    address rewardProgramID
  ) public view returns (bool) {
    return rewardSafes[rewardProgramID].contains(rewardSafe);
  }

  function encodeTransactionData(bytes memory signature)
    public
    view
    returns (
      address,
      bytes memory,
      Enum.Operation,
      bytes memory
    )
  {
    (
      address to,
      uint256 value,
      bytes memory payload,
      uint8 operation,
      uint256 safeTxGas,
      uint256 baseGas,
      uint256 gasPrice,
      address gasToken,
      address refundReceiver,
      uint256 nonce
    ) = abi.decode(
        signature,
        (
          address,
          uint256,
          bytes,
          uint8,
          uint256,
          uint256,
          uint256,
          address,
          address,
          uint256
        )
      );
    return (
      to,
      GnosisSafe(msg.sender).encodeTransactionData(
        to,
        value,
        payload,
        Enum.Operation(operation),
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        nonce
      ),
      Enum.Operation(operation),
      payload
    );
  }

  // isValidSignature uses a guard-pattern to restrict gnosis transactions from reward safe
  // - prevent a safe eoa owner to interact directly with gnosis safe directly without going through the reward manager contract, e.g. executing SWAP_OWNER
  // - any gnosis execution of this safe will hit this callback
  // - facilitate the use of nested gnosis execution, we do it st any gnosis function calls (.e.g SWAP_OWNER) can only be executed on the reward manager contract itself
  // - reward safe has two owners, the eoa and the reward manager contract
  //
  // See inline comments for signature validity logic
  //
  function isValidSignature(bytes memory data, bytes memory signature)
    public
    view
    returns (bytes4)
  {
    (
      address to,
      bytes memory encodedTransactionData,
      Enum.Operation operation,
      bytes memory payload
    ) = encodeTransactionData(signature);

    // _equalBytes checks that the data verifying part of the eip1271 signature to make sure that the user is not trying to exploit this callback, for example, if they pass in a different nonce or different payload
    require(
      _equalBytes(data, encodedTransactionData),
      "Signature data mismatch"
    );

    if (operation == Enum.Operation.DelegateCall) {
      // Allow DelegateCall operations to the designated delegate implementation contract
      require(to == safeDelegateImplementation, "Invalid delegate contract");

      address manager = _extractFirstPayloadArgument(payload);

      // By convention, the first payload argument for any function we execute as a delegateCall must be
      // the verifying contract that has the isValidSignature function. The other params are validated
      // by the code in the RewardSafeDelegateImplementation as necessary, but by validating this address,
      // we provide a trusted contract that can be queried for known state
      require(manager == address(this), "invalid manager");

      return EIP1271_MAGIC_VALUE;
    } else if (eip1271Contracts.contains(to)) {
      // Allow gnosis exec of reward safe to call any function on federated contracts
      // essentially, we can lock all reward safe transactions by unfederating a contract
      return EIP1271_MAGIC_VALUE;
    }

    return bytes4(0);
  }

  function isValidToken(address tokenAddress) external view returns (bool) {
    return
      TokenManager(ActionDispatcher(actionDispatcher).tokenManager())
        .isValidToken(tokenAddress);
  }

  function _extractFirstPayloadArgument(bytes memory payload)
    private
    pure
    returns (address)
  {
    // the payload starts with the method selector, and so needs an offset
    // before decoding the params
    uint256 begin = 5;
    uint256 end = begin + 31;

    bytes memory a = new bytes(32);
    for (uint256 i = 0; i <= end - begin; i++) {
      a[i] = payload[i + begin - 1];
    }

    return abi.decode(a, (address));
  }

  function _equalBytes(bytes memory bytesArr1, bytes memory bytesArr2)
    internal
    pure
    returns (bool)
  {
    return
      keccak256(abi.encodePacked(bytesArr1)) ==
      keccak256(abi.encodePacked(bytesArr2));
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
