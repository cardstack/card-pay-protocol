pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/contract-upgradeable/contracts/cryptography/MerkleProof.sol";
import "@openzeppelin/contract-upgradeable/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contract-upgradeable/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contract-upgradeable/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

import "./token/IERC677.sol";
import "./core/Versionable.sol";
import "./RewardManager.sol";
import "./TokenManager.sol";
import "./VersionManager.sol";

contract RewardPool is Initializable, Versionable, Ownable, ReentrancyGuard {
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

  mapping(bytes32 => bool) private rewardsClaimed; //payment cycle <> rewardProgramID <> token <> rewardee
  mapping(uint256 => bytes32) private payeeRoots;
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
    bytes memory leaf,
    bytes32[] memory proof
  ) public view returns (bool) {
        (
      address rewardProgramID,
      uint256 paymentCycleNumber,
      uint256 startBlock,
      uint256 endBlock,
      uint256 tokenType,
      address payee,
      bytes memory transferDetails
    ) = abi.decode(leaf, (address, uint256, uint256, uint256, uint256, address, bytes));
    bytes32 root = bytes32(payeeRoots[paymentCycleNumber]);
    return proof.verify(root, keccak256(leaf));
  }

  function claimed(bytes memory leaf) public view returns (bool) {
    return rewardsClaimed[keccak256(leaf)];
  }

  function claimERC667(bytes memory leaf, address rewardProgramID, address rewardSafeOwner, bytes memory transferDetails, bool partialClaimAllowed) internal {
      (
        address payableToken,
        uint256 amount
      ) = abi.decode(transferDetails, (address, uint256));
      // If the sender is willing to accept a partial claim and there isn't enough to cover the entire claim,
      // then we can only claim the amount that is available _unless_ there is nothing left   
      if (partialClaimAllowed && rewardBalance[rewardProgramID][payableToken] < amount && rewardBalance[rewardProgramID][payableToken] > 0) {
        console.log("partial claim");
        amount = rewardBalance[rewardProgramID][payableToken];
      }
      require(
        IERC677(payableToken).balanceOf(address(this)) >= amount,
        "Reward pool has insufficient balance"
      );
      require(
        rewardBalance[rewardProgramID][payableToken] >= amount,
        //|| (partialClaimAllowed && rewardBalance[rewardProgramID][payableToken] > 0),
        "Reward program has insufficient balance inside reward pool"
      );

      rewardsClaimed[keccak256(leaf)] = true;

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
  }


  function claimSpecificERC721(bytes memory leaf, address rewardProgramID, address rewardSafeOwner, bytes memory transferDetails) internal {
      (
        address payableToken,
        uint256 tokenId
      ) = abi.decode(transferDetails, (address, uint256));

      // Is this OK? Or is there a risk because a merkle leaf can transfer any token
      require(
        IERC721(payableToken).getApproved(tokenId) == address(this),
        "Reward pool is not approved for this transfer"
      );

      rewardsClaimed[keccak256(leaf)] = true;

      IERC721(payableToken).safeTransferFrom(IERC721(payableToken).ownerOf(tokenId), msg.sender, tokenId);

      emit RewardeeClaim(
        rewardProgramID,
        rewardSafeOwner,
        msg.sender,
        payableToken,
        1 // token ID?
      );
  }

  function claim(
    bytes calldata leaf,
    bytes32[] calldata proof,
    bool partialClaimAllowed
  ) external nonReentrant() returns (bool) {

      (
      address rewardProgramID,
      uint256 paymentCycleNumber,
      uint256 startBlock,
      uint256 endBlock,
      uint256 tokenType,
      address payee,
      bytes memory transferDetails
    ) = abi.decode(leaf, (address, uint256, uint256, uint256, uint256, address, bytes));

    require(tokenType > 0, "Non-claimable proof, use valid(leaf, proof) to check validity");
    require(block.number >= startBlock, "Can only be claimed on or after the start block");
    require(block.number < endBlock, "Can only be claimed before end block");
    require(valid(leaf, proof), "Proof is invalid");
    require(claimed(leaf) == false, "Reward has already been claimed");


    address rewardSafeOwner = RewardManager(rewardManager).getRewardSafeOwner(
      msg.sender
    );

    require(rewardSafeOwner == payee, "Can only be claimed by payee");

    require(
      RewardManager(rewardManager).isValidRewardSafe(
        msg.sender,
        rewardProgramID
      ),
      "can only withdraw for safe registered on reward program"
    );

    if (tokenType == 1) {
      // Type 1: ERC667 fungible tokens
      claimERC667(leaf, rewardProgramID, rewardSafeOwner, transferDetails, partialClaimAllowed);
      return true;
    } else if (tokenType == 2) {
       // Type 2: ERC721 NFTs with specific IDs
      claimSpecificERC721(leaf, rewardProgramID, rewardSafeOwner, transferDetails);
      return true;
    } else if (tokenType == 3) {
      // Type 3: ERC721 with no token ID
      return false;
    } else {
      return false;
    }
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
