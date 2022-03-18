pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/utils/cryptography/MerkleProofUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

import "./core/Ownable.sol";
import "./token/IERC677.sol";
import "./core/Versionable.sol";
import "./RewardManager.sol";
import "./TokenManager.sol";
import "./VersionManager.sol";

contract RewardPool is Initializable, Versionable, Ownable {
  using MerkleProofUpgradeable for bytes32[];
  using SafeERC20Upgradeable for IERC677;

  event Setup(address tally, address rewardManager, address tokenManager);
  event RewardeeClaim(
    address rewardProgramID,
    address rewardee,
    address rewardSafe,
    address token,
    uint256 amount,
    bytes leaf
  );
  event MerkleRootSubmission(
    bytes32 payeeRoot,
    address rewardProgramID,
    uint256 paymentCycle
  );
  event RewardTokensAdded(
    address rewardProgramID,
    address sender,
    address tokenAddress,
    uint256 amount
  );
  event RewardTokensRecovered(
    address rewardProgramID,
    address token,
    uint256 amount,
    address rewardProgramAdmin
  );

  address internal constant ZERO_ADDRESS = address(0);
  address public tally;
  address public rewardManager;
  address public tokenManager;

  mapping(bytes32 => bool) private rewardsClaimed; // hash of leaf node -> claimed status
  mapping(address => mapping(uint256 => bytes32)) public payeeRoots; // reward program ID -> payment cycle -> merkle root
  mapping(address => mapping(address => uint256)) public rewardBalance; // reward program ID -> token -> balance
  address public versionManager;

  modifier onlyTally() {
    require(tally == msg.sender, "Caller is not tally");
    _;
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

  function submitPayeeMerkleRoot(
    address rewardProgramID,
    uint256 paymentCycle,
    bytes32 payeeRoot
  ) external onlyTally returns (bool) {
    require(
      RewardManager(rewardManager).isRewardProgram(rewardProgramID),
      "Can only submit a root for a registered reward program"
    );
    require(
      payeeRoots[rewardProgramID][paymentCycle] == 0,
      "Payee root already submitted for this program & cycle"
    );
    payeeRoots[rewardProgramID][paymentCycle] = payeeRoot;

    emit MerkleRootSubmission(payeeRoot, rewardProgramID, paymentCycle);

    return true;
  }

  function valid(bytes memory leaf, bytes32[] memory proof)
    public
    view
    returns (bool)
  {
    (
      address rewardProgramID,
      uint256 paymentCycleNumber,
      uint256 validFrom,
      uint256 validTo,
      ,
      ,

    ) = abi.decode(
        leaf,
        (address, uint256, uint256, uint256, uint256, address, bytes)
      );
    if (block.number >= validFrom && block.number < validTo) {
      bytes32 root = bytes32(payeeRoots[rewardProgramID][paymentCycleNumber]);
      return proof.verify(root, keccak256(leaf));
    } else {
      return false;
    }
  }

  function claimed(bytes memory leaf) public view returns (bool) {
    return rewardsClaimed[keccak256(leaf)];
  }

  function claimERC667(
    bytes memory leaf,
    address rewardProgramID,
    address rewardSafeOwner,
    bytes memory transferDetails,
    bool acceptPartialClaim
  ) internal {
    (address payableToken, uint256 amount) = abi.decode(
      transferDetails,
      (address, uint256)
    );
    uint256 rewardProgramBalance = rewardBalance[rewardProgramID][payableToken];

    require(rewardProgramBalance > 0, "Reward program balance is empty");
    // If the sender is willing to accept a partial claim and there isn't enough to cover the entire claim,
    // then we can only claim the amount that is available _unless_ there is nothing left
    if (acceptPartialClaim && rewardProgramBalance < amount) {
      amount = rewardProgramBalance;
    }
    require(
      IERC677(payableToken).balanceOf(address(this)) >= amount,
      "Reward pool has insufficient balance"
    );
    require(
      rewardProgramBalance >= amount,
      "Reward program has insufficient balance inside reward pool"
    );

    rewardsClaimed[keccak256(leaf)] = true;

    rewardBalance[rewardProgramID][payableToken] =
      rewardProgramBalance -
      amount;

    IERC677(payableToken).safeTransfer(msg.sender, amount);

    emit RewardeeClaim(
      rewardProgramID,
      rewardSafeOwner,
      msg.sender,
      payableToken,
      amount,
      leaf
    );
  }

  function claim(
    bytes calldata leaf,
    bytes32[] calldata proof,
    bool acceptPartialClaim
  ) external returns (bool) {
    (
      address rewardProgramID,
      ,
      uint256 validFrom,
      uint256 validTo,
      uint256 tokenType,
      address payee,
      bytes memory transferDetails
    ) = abi.decode(
        leaf,
        (address, uint256, uint256, uint256, uint256, address, bytes)
      );

    require(
      tokenType > 0,
      "Non-claimable proof, use valid(leaf, proof) to check validity"
    );
    require(tokenType == 1, "Token type currently unsupported");
    require(
      block.number >= validFrom,
      "Can only be claimed on or after the start block"
    );
    require(block.number < validTo, "Can only be claimed before end block");
    require(valid(leaf, proof), "Proof is invalid");
    require(claimed(leaf) == false, "Reward has already been claimed");

    address rewardSafeOwner = RewardManager(rewardManager).getRewardSafeOwner(
      payable(msg.sender)
    );

    require(rewardSafeOwner == payee, "Can only be claimed by payee");

    require(
      RewardManager(rewardManager).isValidRewardSafe(
        payable(msg.sender),
        rewardProgramID
      ),
      "can only withdraw for safe registered on reward program"
    );

    // if statement commented out due to code coverage rules - add back in when
    // more token types are supported.

    // if (tokenType == 1) {
    // Type 1: ERC667 fungible tokens
    claimERC667(
      leaf,
      rewardProgramID,
      rewardSafeOwner,
      transferDetails,
      acceptPartialClaim
    );
    return true;
    // }
  }

  function recoverTokens(
    address rewardProgramID,
    address token,
    uint256 amount
  ) external {
    address rewardProgramAdmin = RewardManager(rewardManager)
      .rewardProgramAdmins(rewardProgramID);
    require(
      rewardProgramAdmin != ZERO_ADDRESS,
      "reward program admin does not exist"
    );
    require(
      _getEOAOwner(payable(msg.sender)) == rewardProgramAdmin,
      "owner of safe is not reward program admin"
    );
    require(
      rewardBalance[rewardProgramID][token] >= amount,
      "not enough tokens to withdraw"
    );
    rewardBalance[rewardProgramID][token] =
      rewardBalance[rewardProgramID][token] -
      amount;
    emit RewardTokensRecovered(
      rewardProgramID,
      token,
      amount,
      rewardProgramAdmin
    );

    IERC677(token).safeTransfer(msg.sender, amount);
  }

  // lazy implementation of getting eoa owner of safe that has 1 or 2 owners
  // think this is a use-case to handle during safe manager refactor
  function _getEOAOwner(address payable safe) internal view returns (address) {
    address[] memory ownerArr = GnosisSafe(safe).getOwners();
    if (ownerArr.length == 2) {
      return ownerArr[1];
    } else {
      return ownerArr[0];
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
    rewardBalance[rewardProgramID][msg.sender] =
      rewardBalance[rewardProgramID][msg.sender] +
      amount;

    emit RewardTokensAdded(rewardProgramID, from, msg.sender, amount);

    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
