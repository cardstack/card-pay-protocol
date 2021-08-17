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

contract RewardPool is Initializable, Versionable, Ownable {
  using SafeMath for uint256;
  using MerkleProof for bytes32[];

  event Setup(address tally, address rewardManager);
  event RewardeeClaim(
    address rewardProgramID,
    address rewardee,
    address rewardSafe,
    uint256 amount
  );
  event MerkleRootSubmission(bytes32 payeeRoot, uint256 numPaymentCycles);
  event PaymentCycleEnded(
    uint256 paymentCycle,
    uint256 startBlock,
    uint256 endBlock
  );

  address internal constant ZERO_ADDRESS = address(0);
  address public tally;
  uint256 public numPaymentCycles;
  uint256 public currentPaymentCycleStartBlock;
  address public rewardManager;

  mapping(address => mapping(address => mapping(address => uint256))) public claims; // token <> rewardee
  mapping(uint256 => bytes32) payeeRoots;

  modifier onlyTally() {
    require(tally == msg.sender, "Caller is not tally");
    _;
  }

  function initialize(address owner) public initializer {
    numPaymentCycles = 1;
    Ownable.initialize(owner);
  }

  function setup(address _tally, address _rewardManager) external onlyOwner {
    tally = _tally;
    rewardManager = _rewardManager;
    require(tally != ZERO_ADDRESS, "Tally should not be zero address");
    require(
      rewardManager != ZERO_ADDRESS,
      "Reward Manager should not be zero address"
    );
    emit Setup(_tally, _rewardManager);
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

  //msg.sender is safe
  function claim(
    address rewardProgramID,
    address payableToken,
    uint256 amount,
    bytes calldata proof
  ) external returns (bool) {
    require(amount > 0, "Cannot claim non-positive amount");
    address rewardSafeOwner =
      RewardManager(rewardManager).getRewardSafeOwner(msg.sender);
    require(RewardManager(rewardManager).isValidRewardSafe(msg.sender, rewardProgramID), "can only withdraw for safe registered on reward program");
    uint256 balance =
      _balanceForProofWithAddress(
        rewardProgramID,
        payableToken,
        rewardSafeOwner,
        proof
      );
    require(balance >= amount, "Insufficient balance for proof");

    require(
      IERC677(payableToken).balanceOf(address(this)) >= amount,
      "Reward pool has insufficient balance"
    );

    claims[rewardProgramID][payableToken][rewardSafeOwner] = claims[rewardProgramID][payableToken][
      rewardSafeOwner
    ]
      .add(amount);
    IERC677(payableToken).transfer(msg.sender, amount);

    emit RewardeeClaim(rewardProgramID, rewardSafeOwner, msg.sender, amount);
    return true;
  }

  function balanceForProofWithAddress(
    address rewardProgramID,
    address payableToken,
    address _address,
    bytes calldata proof
  ) external view returns (uint256) {
    return
      _balanceForProofWithAddress(
        rewardProgramID,
        payableToken,
        _address,
        proof
      );
  }

  function balanceForProof(
    address rewardProgramID,
    address payableToken,
    bytes memory proof
  ) public view returns (uint256) {
    return
      _balanceForProofWithAddress(
        rewardProgramID,
        payableToken,
        msg.sender,
        proof
      );
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

  function _balanceForProofWithAddress(
    address rewardProgramID,
    address payableToken,
    address _address,
    bytes memory proof
  ) internal view returns (uint256) {
    bytes32[] memory meta;
    bytes32[] memory _proof;

    (meta, _proof) = splitIntoBytes32(proof, 2);

    uint256 paymentCycleNumber = uint256(meta[0]);
    uint256 cumulativeAmount = uint256(meta[1]);
    if (payeeRoots[paymentCycleNumber] == 0x0) {
      return 0;
    }

    bytes32 leaf =
      keccak256(
        abi.encodePacked(
          rewardProgramID,
          payableToken,
          _address,
          cumulativeAmount
        )
      );
    if (
      claims[rewardProgramID][payableToken][_address] < cumulativeAmount &&
      _proof.verify(payeeRoots[paymentCycleNumber], leaf)
    ) {
      return cumulativeAmount.sub(claims[rewardProgramID][payableToken][_address]);
    } else {
      return 0;
    }
  }

  function splitIntoBytes32(bytes memory byteArray, uint256 numBytes32)
    internal
    pure
    returns (bytes32[] memory bytes32Array, bytes32[] memory remainder)
  {
    require(byteArray.length.div(32) <= 50, "Bytearray provided is too big");
    require(
      byteArray.length % 32 == 0 && byteArray.length >= numBytes32.mul(32),
      "Bytearray provided has wrong shape"
    );

    bytes32Array = new bytes32[](numBytes32);
    remainder = new bytes32[](byteArray.length.sub(64).div(32));
    bytes32 _bytes32;
    for (uint256 k = 32; k <= byteArray.length; k = k.add(32)) {
      assembly {
        _bytes32 := mload(add(byteArray, k))
      }
      if (k <= numBytes32 * 32) {
        bytes32Array[k.sub(32).div(32)] = _bytes32;
      } else {
        remainder[k.sub(96).div(32)] = _bytes32;
      }
    }
  }
}
