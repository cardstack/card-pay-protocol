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

contract RewardManager is Ownable, Versionable, Safe {
  using EnumerableSet for EnumerableSet.AddressSet;
  using SafeMath for uint256;

  event Setup();
  event RewardProgramCreated(address rewardProgramID, address admin);
  event RewardProgramRemoved(address rewardProgramID);
  event RewardProgramAdminUpdated(address rewardProgramID, address newAdmin);
  event RewardProgramLocked(address rewardProgramID);
  event RewardSafeTransferred(
    address rewardSafe,
    address oldOwner,
    address newOwner
  );
  event RewardRuleAdded(address rewardProgramID, bytes blob);
  event RewardSafeWithdrawal(address rewardSafe, address token, uint256 value);
  event RewardeeRegistered(
    address rewardProgramID,
    address rewardee,
    address rewardSafe
  );

  address internal constant ZERO_ADDRESS = address(0);
  bytes4 internal constant EIP1271_MAGIC_VALUE = 0x20c13b0b;
  bytes4 internal constant SWAP_OWNER = 0xe318b52b; //swapOwner(address,address,address)
  bytes4 internal constant TRANSFER = 0xa9059cbb; //transfer(address,uint256)
  uint256 internal _nonce;

  address public actionDispatcher;
  uint256 public rewardProgramRegistrationFeeInSPEND;
  address payable public rewardFeeReceiver; // will receive receive all fees
  address public governanceAdmin; // eoa with governance powers

  EnumerableSet.AddressSet rewardProgramIDs;
  EnumerableSet.AddressSet eip1271Contracts;
  mapping(address => EnumerableSet.AddressSet) internal rewardSafes; //reward program id <> reward safes
  mapping(address => bytes) public rule; //reward program id <> bytes32
  mapping(address => address) public rewardProgramAdmins; //reward program id <> reward program admins
  mapping(address => bool) public rewardProgramLocked; //reward program id <> locked
  mapping(address => mapping(address => address)) public ownedRewardSafes; // EOA <> reward program id <> reward safe address
  mapping(address => address) public rewardProgramsForRewardSafes; // reward safe <> reward program id
  mapping(bytes32 => bool) internal signatures;
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
    address _versionManager
  ) external onlyOwner {
    require(_rewardFeeReceiver != ZERO_ADDRESS, "rewardFeeReceiver not set");
    require(
      _rewardProgramRegistrationFeeInSPEND > 0,
      "rewardProgramRegistrationFeeInSPEND is not set"
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

  function transferRewardSafe(
    address newOwner,
    uint256 safeTxGas,
    uint256 baseGas,
    uint256 gasPrice,
    address gasToken,
    bytes calldata signature
  ) external {
    address oldOwner = getRewardSafeOwner(msg.sender);
    bytes memory conSignature = contractSignature(msg.sender, oldOwner);
    address rewardProgramID = rewardProgramsForRewardSafes[msg.sender];
    assert(ownedRewardSafes[oldOwner][rewardProgramID] == msg.sender);
    ownedRewardSafes[oldOwner][rewardProgramID] = address(0);

    signatures[keccak256(conSignature)] = true;
    execTransaction(
      msg.sender,
      0,
      abi.encodeWithSelector(SWAP_OWNER, address(this), oldOwner, newOwner),
      safeTxGas,
      baseGas,
      gasPrice,
      gasToken,
      signature,
      msg.sender
    );
    signatures[keccak256(conSignature)] = false;

    ownedRewardSafes[newOwner][rewardProgramID] = msg.sender;

    emit RewardSafeTransferred(msg.sender, oldOwner, newOwner);
  }

  function withdrawFromRewardSafe(
    address token,
    uint256 value,
    uint256 safeTxGas,
    uint256 baseGas,
    uint256 gasPrice,
    address gasToken,
    bytes calldata signature
  ) external {
    address rewardSafeOwner = getRewardSafeOwner(msg.sender);
    bytes memory conSignature = contractSignature(msg.sender, rewardSafeOwner);
    signatures[keccak256(conSignature)] = true;

    execTransaction(
      token,
      0,
      abi.encodeWithSelector(TRANSFER, rewardSafeOwner, value),
      safeTxGas,
      baseGas,
      gasPrice,
      gasToken,
      signature,
      msg.sender
    );
    signatures[keccak256(conSignature)] = false;
    emit RewardSafeWithdrawal(msg.sender, token, value);
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

  function getRewardProgramAdmin(address rewardProgramID)
    public
    view
    returns (address)
  {
    return rewardProgramAdmins[rewardProgramID];
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
    returns (address, bytes memory)
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
        Enum.Operation.Call,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        nonce
      )
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
    (address to, bytes memory encodedTransactionData) = encodeTransactionData(
      signature
    );
    address rewardSafeOwner = getRewardSafeOwner(msg.sender);

    bytes memory contractSignature = _contractSignature(
      msg.sender,
      rewardSafeOwner
    );

    // Signature must always match
    require(
      _equalBytes(data, encodedTransactionData),
      "Signature data mismatch"
    );

    // One of these three conditions must be true for the signature to be valid:

    // 1. allows gnosis exec of reward safe to call any function on reward manager
    if (to == address(this)) {
      return EIP1271_MAGIC_VALUE;
    }

    // 2. allows gnosis exec of reward safe to call any function on federated contracts
    //    essentially, we can lock all reward safe transactions by unfederating a contract
    if (eip1271Contracts.contains(to)) {
      return EIP1271_MAGIC_VALUE;
    }

    // 3. allows gnosis exec of a gnosis function call, .e.g. SWAP_OWNER to the reward safe
    //    signatures is a state variable that needs to be switched on in the reward manager contract function to execute the inner safe transaction. This prevents the direct interaction with the safe.
    //    _equalBytes checks that the data verifying part of the eip1271 signature to make sure that the user is not trying to exploit this callback, for example, if they pass in a different nonce or different payload
    //    isAllowedGnosisRecipient checks if the recipient of the message is the same as the sender, or alternatively if the message is to an allowed token contract
    if (
      signatures[keccak256(contractSignature)] && isAllowedGnosisRecipient(to)
    ) {
      return EIP1271_MAGIC_VALUE;
    }

    return bytes4(0);
  }

  function isAllowedGnosisRecipient(address to) private view returns (bool) {
    return
      (to == msg.sender) ||
      TokenManager(ActionDispatcher(actionDispatcher).tokenManager())
        .isValidToken(to);
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

  function contractSignature(address rewardSafe, address owner)
    internal
    returns (bytes memory)
  {
    _nonce++;
    return _contractSignature(rewardSafe, owner);
  }

  function _contractSignature(address rewardSafe, address owner)
    private
    view
    returns (bytes memory)
  {
    return
      abi.encodePacked(
        keccak256(abi.encodePacked(address(this), _nonce, rewardSafe, owner))
      );
  }

  function execTransaction(
    address to,
    uint256 value,
    bytes memory data,
    uint256 safeTxGas,
    uint256 baseGas,
    uint256 gasPrice,
    address gasToken,
    bytes memory signature,
    address payable rewardSafe
  ) private returns (bool) {
    require(
      GnosisSafe(rewardSafe).execTransaction(
        to,
        value,
        data,
        Enum.Operation.Call, //only call operations
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        rewardSafe,
        signature
      ),
      "safe transaction was reverted"
    );

    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
