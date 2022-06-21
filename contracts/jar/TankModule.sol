pragma solidity ^0.8.9;
pragma abicoder v1;

import "@gnosis.pm/zodiac/contracts/core/Module.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "../core/ReentrancyGuard.sol";
import "../token/IERC677.sol";
import "../MerchantManager.sol";
import "../TokenManager.sol";

contract TankModule is Module, ReentrancyGuard {
  using SafeMathUpgradeable for uint256;
  using SafeERC20Upgradeable for IERC677;

  event TankModuleSetup(
    address indexed initiator,
    address indexed owner,
    address indexed avatar,
    address target,
    address merchantManager,
    address tokenManager,
    address feeReceiver,
    uint256 feePercentage,
    uint256 lockTime,
    uint256 lastRefundTime
  );
  event FundLocked(
    uint256 indexed queueNonce,
    address indexed token,
    address sender,
    uint256 amount,
    uint256 startLockTime
  );
  event FundReleased(
    uint256 indexed queueNonce,
    address indexed token,
    uint256 amountProceeds
  );
  event FeeCollected(
    uint256 indexed queueNonce,
    address indexed token,
    uint256 fee
  );
  event FundRefunded(
    uint256 indexed queueNonce,
    address indexed token,
    address sender,
    uint256 amount
  );

  struct LockedFund {
    address sender;
    address token;
    uint256 amount;
    uint256 startLockTime;
    bool isRefunded;
  }

  struct RefundableAmount {
    //Mapping from token address to amount
    mapping(address => uint256) amount;
  }

  // 0xa9059cbb - bytes4(keccak256("transfer(address,uint256)"))
  bytes4 public constant TRANSFER = 0xa9059cbb;
  uint256 public constant FEE_DECIMALS = 8;

  address public merchantManagerAddress;
  address public tokenManagerAddress;

  address public feeReceiver;
  uint256 public feePercentage; // decimals 8

  uint256 public lockTime;
  uint256 public lastRefundTime;

  uint256 public queueNonce;
  uint256 public txNonce;
  // Mapping of queue nonce to locked fund
  mapping(uint256 => LockedFund) public lockedFund;
  // Mapping of token to locked amount
  mapping(address => uint256) public lockedAmount;
  // Mapping of sender address to refundable amount
  mapping(address => RefundableAmount) private refundableAmount;

  constructor(
    address _owner,
    address _avatar,
    address _target,
    address _merchantManagerAddress,
    address _tokenManagerAddress,
    address _feeReceiver,
    uint256 _feePercentage,
    uint256 _lockTime,
    uint256 _lastRefundTime
  ) {
    bytes memory initParams = abi.encode(
      _owner,
      _avatar,
      _target,
      _merchantManagerAddress,
      _tokenManagerAddress,
      _feeReceiver,
      _feePercentage,
      _lockTime,
      _lastRefundTime
    );
    setUp(initParams);
  }

  function setUp(bytes memory initParams) public override initializer {
    (
      address _owner,
      address _avatar,
      address _target,
      address _merchantManagerAddress,
      address _tokenManagerAddress,
      address _feeReceiver,
      uint256 _feePercentage,
      uint256 _lockTime,
      uint256 _lastRefundTime
    ) = abi.decode(
        initParams,
        (
          address,
          address,
          address,
          address,
          address,
          address,
          uint256,
          uint256,
          uint256
        )
      );
    __Ownable_init();
    require(_avatar != address(0), "avatar can not be zero address");
    require(_target != address(0), "target can not be zero address");
    require(
      _merchantManagerAddress != address(0),
      "merchant manager can not be zero address"
    );
    require(
      _tokenManagerAddress != address(0),
      "token manager can not be zero address"
    );

    avatar = _avatar;
    target = _target;
    merchantManagerAddress = _merchantManagerAddress;
    tokenManagerAddress = _tokenManagerAddress;
    feeReceiver = _feeReceiver;
    feePercentage = _feePercentage;
    lockTime = _lockTime;
    lastRefundTime = _lastRefundTime;

    transferOwnership(_owner);

    emit TankModuleSetup(
      msg.sender,
      _owner,
      _avatar,
      _target,
      _merchantManagerAddress,
      _tokenManagerAddress,
      _feeReceiver,
      _feePercentage,
      _lockTime,
      _lastRefundTime
    );
  }

  function onTokenTransfer(
    address payable from,
    uint256 amount,
    bytes calldata
  ) external nonReentrant returns (bool) {
    require(
      TokenManager(tokenManagerAddress).isValidToken(msg.sender),
      "calling token is unaccepted"
    );
    require(amount > 0, "amount must be greater than 0");
    require(
      !MerchantManager(merchantManagerAddress).isMerchantSafeDisabled(avatar),
      "merchant safe is disabled"
    );

    IERC677 erc677Token = IERC677(msg.sender);
    require(
      erc677Token.balanceOf(address(this)) >= amount,
      "amount to transfer is greater than balance"
    );

    lockedFund[queueNonce].sender = from;
    lockedFund[queueNonce].token = msg.sender;
    lockedFund[queueNonce].amount = amount;
    lockedFund[queueNonce].startLockTime = block.timestamp;

    lockedAmount[msg.sender] = lockedAmount[msg.sender].add(amount);
    refundableAmount[from].amount[msg.sender] = refundableAmount[from]
      .amount[msg.sender]
      .add(amount);

    bool result = erc677Token.transfer(avatar, amount);
    if (!result) return false;

    emit FundLocked(
      queueNonce,
      msg.sender,
      from,
      amount,
      lockedFund[queueNonce].startLockTime
    );
    queueNonce++;
    return true;
  }

  function releaseFund() public {
    require(queueNonce > txNonce, "no fund was locked");

    LockedFund memory _lockedFund = lockedFund[txNonce];
    require(
      block.timestamp.sub(_lockedFund.startLockTime) >= lockTime,
      "fund still in locking period"
    );
    require(!_lockedFund.isRefunded, "fund has been refunded");

    lockedAmount[_lockedFund.token] = lockedAmount[_lockedFund.token].sub(
      _lockedFund.amount
    );
    refundableAmount[_lockedFund.sender].amount[
      _lockedFund.token
    ] = refundableAmount[_lockedFund.sender].amount[_lockedFund.token].sub(
      _lockedFund.amount
    );

    uint256 ten = 10;
    uint256 fee = feePercentage > 0
      ? (_lockedFund.amount * feePercentage) / (ten**FEE_DECIMALS)
      : 0;
    uint256 amountProceeds = _lockedFund.amount - fee;
    bytes memory feeData = abi.encodeWithSelector(TRANSFER, feeReceiver, fee);
    require(
      exec(_lockedFund.token, 0, feeData, Enum.Operation.Call),
      "module transaction fee failed"
    );

    emit FundReleased(txNonce, _lockedFund.token, amountProceeds);
    emit FeeCollected(txNonce, _lockedFund.token, fee);
  }

  function claimBackFund(uint256 _queueNonce) public {
    LockedFund memory _lockedFund = lockedFund[_queueNonce];
    require(
      block.timestamp.sub(_lockedFund.startLockTime) < lockTime,
      "fund not in locking period"
    );
    require(!_lockedFund.isRefunded, "fund has been refunded");

    lockedAmount[_lockedFund.token] = lockedAmount[_lockedFund.token].sub(
      _lockedFund.amount
    );
    refundableAmount[_lockedFund.sender].amount[
      _lockedFund.token
    ] = refundableAmount[_lockedFund.sender].amount[_lockedFund.token].sub(
      _lockedFund.amount
    );
    lockedFund[_queueNonce].isRefunded = true;

    bytes memory data = abi.encodeWithSelector(
      TRANSFER,
      _lockedFund.sender,
      _lockedFund.amount
    );
    require(
      exec(_lockedFund.token, 0, data, Enum.Operation.Call),
      "error on module refund transaction"
    );
    emit FundRefunded(
      _queueNonce,
      _lockedFund.token,
      _lockedFund.sender,
      _lockedFund.amount
    );
  }

  function skipRefundedFund() public {
    while (lockedFund[txNonce].isRefunded) {
      txNonce++;
    }
  }

  function getRefundableAmount(address sender, address token)
    public
    view
    returns (uint256)
  {
    return refundableAmount[sender].amount[token];
  }

  function setMerchantManagerAddress(address _merchantManagerAddress)
    public
    onlyOwner
  {
    merchantManagerAddress = _merchantManagerAddress;
  }

  function setTokenManagerAddress(address _tokenManagerAddress)
    public
    onlyOwner
  {
    tokenManagerAddress = _tokenManagerAddress;
  }

  function setLockTime(uint256 _lockTime) public onlyOwner {
    lockTime = _lockTime;
  }
}
