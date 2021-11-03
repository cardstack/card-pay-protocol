pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/contract-upgradeable/contracts/cryptography/MerkleProof.sol";
import "@openzeppelin/contract-upgradeable/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

import "./token/IERC677.sol";
import "./core/Versionable.sol";
import "./RewardManager.sol";
import "./TokenManager.sol";
import "./VersionManager.sol";

contract RewardPool is Initializable, Versionable, Ownable {
  using SafeMath for uint256;
  using MerkleProof for bytes32[];

  event Setup(address tally, address rewardManager, address tokenManager);
  event RewardeeClaim(
    address rewardProgramID,
    address rewardee,
    address rewardSafe,
    address token,
    uint256 amount
  );
  event MerkleRootSubmission(bytes32 payeeRoot, uint256 numPaymentCycles);
  event PaymentCycleEnded(
    uint256 paymentCycle,
    uint256 startBlock,
    uint256 endBlock
  );
  event RewardTokensAdded(
    address rewardProgramID,
    address sender,
    address tokenAddress,
    uint256 amount
  );

  address internal constant ZERO_ADDRESS = address(0);
  address public tally;
  uint256 public numPaymentCycles;
  uint256 public currentPaymentCycleStartBlock;
  address public rewardManager;
  address public tokenManager;

  mapping(uint256 => mapping(address => mapping(address => mapping(address => bool))))
    public rewardsClaimed; //payment cycle <> rewardProgramID <> token <> rewardee
  mapping(uint256 => bytes32) payeeRoots;
  mapping(address => mapping(address => uint256)) public rewardBalance;
  address public versionManager;

  modifier onlyTally() {
    require(tally == msg.sender, "Caller is not tally");
    _;
  }

  function initialize(address owner) public initializer {
    numPaymentCycles = 1;
    Ownable.initialize(owner);
  }

  function setup(
    address _tally,
    address _rewardManager,
    address _tokenManager,
    address _versionManager
  ) external onlyOwner {
    tally = _tally;
    rewardManager = _rewardManager;
    tokenManager = _tokenManager;
    versionManager = _versionManager;
    require(tally != ZERO_ADDRESS, "Tally should not be zero address");
    require(
      rewardManager != ZERO_ADDRESS,
      "Reward Manager should not be zero address"
    );
    emit Setup(_tally, _rewardManager, _tokenManager);
  }

  function submitPayeeMerkleRoot(bytes32 payeeRoot)
    external
    onlyTally
    returns (bool)
  {
    payeeRoots[numPaymentCycles] = payeeRoot;

    emit MerkleRootSubmission(payeeRoot, numPaymentCycles);
    startNewPaymentCycle();

    return true;
  }

  function valid(
    bytes calldata leaf,
    bytes calldata proof
  ) external view returns (bool) {
    uint256 paymentCycleNumber = uint256(leaf[4]);
    uint256 root = payeeRoots[paymentCycleNumber];
    return proof.verify(root, keccak256(leaf));
  }

  function claimed(leaf) external view returns (bool) {
    uint256 paymentCycleNumber = uint256(leaf[4]);
    address rewardProgramID = address(leaf[0]);
    address payableToken = address(leaf[1]);
    address rewardee = address(leaf[2]);
    return rewardsClaimed[paymentCycleNumber][rewardProgramID][payableToken][rewardee];
  }

  function claim(
    bytes calldata leaf,
    bytes calldata proof
  ) external returns (bool) {

    uint256 rewardProgramID = uint256(leaf[0]);
    uint256 payableToken = uint256(leaf[1]);
    address payee = address(leaf[2]);
    uint256 amount = uint256(leaf[3]);
    uint256 paymentCycleNumber = uint256(leaf[4]);

    require(msg.sender == payee, "Can only be claimed by payee");
    require(valid(leaf, proof), "Proof is invalid");
    require(claimed(leaf) == false, "Reward has already been claimed");


    address rewardSafeOwner = RewardManager(rewardManager).getRewardSafeOwner(
      msg.sender
    );
    require(
      RewardManager(rewardManager).isValidRewardSafe(
        msg.sender,
        rewardProgramID
      ),
      "can only withdraw for safe registered on reward program"
    );

    require(
      IERC677(payableToken).balanceOf(address(this)) >= amount,
      "Reward pool has insufficient balance"
    );
    require(
      rewardBalance[rewardProgramID][payableToken] >= amount,
      "Reward program has insufficient balance inside reward pool"
    );

    rewardsClaimed[paymentCycleNumber][rewardProgramID][payableToken][
      rewardSafeOwner
    ] = true;

    rewardBalance[rewardProgramID][payableToken] = rewardBalance[
      rewardProgramID
    ][payableToken].sub(amount);
    IERC677(payableToken).transfer(msg.sender, amount);

    emit RewardeeClaim(
      rewardProgramID,
      rewardSafeOwner,
      msg.sender,
      payableToken,
      amount
    );
    return true;
  }

  function onTokenTransfer(
    address from,
    uint256 amount,
    bytes calldata data
  ) external returns (bool) {
    require(
      TokenManager(tokenManager).isValidToken(msg.sender),
      "calling token is unaccepted"
    );
    address rewardProgramID = abi.decode(data, (address));
    require(
      RewardManager(rewardManager).isRewardProgram(rewardProgramID),
      "reward program is not found"
    );
    rewardBalance[rewardProgramID][msg.sender] = rewardBalance[rewardProgramID][
      msg.sender
    ].add(amount);
    emit RewardTokensAdded(rewardProgramID, from, msg.sender, amount);
  }

  function startNewPaymentCycle() internal onlyTally returns (bool) {
    require(
      block.number > currentPaymentCycleStartBlock,
      "Cannot start new payment cycle before currentPaymentCycleStartBlock"
    );

    emit PaymentCycleEnded(
      numPaymentCycles,
      currentPaymentCycleStartBlock,
      block.number
    );

    numPaymentCycles = numPaymentCycles.add(1);
    currentPaymentCycleStartBlock = block.number.add(1);

    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
