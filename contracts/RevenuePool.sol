pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

import "./token/IERC677.sol";
import "./token/ISPEND.sol";
import "./roles/PayableToken.sol";
import "./core/MerchantManager.sol";
import "./Exchange.sol";
import "./core/Versionable.sol";
import "./PrepaidCardManager.sol";
import "./BridgeUtils.sol";

contract RevenuePool is Ownable, Versionable, PayableToken, MerchantManager {
  using SafeMath for uint256;

  struct Action {
    string name;
    address payable prepaidCard;
    address issuingToken;
    uint256 tokenAmount;
    uint256 spendAmount;
    uint256 requestedRate;
    bytes32 nameHash;
    bytes data;
  }

  address payable public merchantFeeReceiver;
  uint256 public merchantFeePercentage; // decimals 8
  uint256 public merchantRegistrationFeeInSPEND;
  address payable public prepaidCardManager;
  address public exchangeAddress;
  mapping(string => address) public actions;
  mapping(address => bool) public isHandler;

  event Setup();
  event HandlerAdded(address handler, string action);
  event HandlerRemoved(address handler, string action);
  event MerchantClaim(
    address merchantSafe,
    address payableToken,
    uint256 amount
  );

  modifier onlyHandlers() {
    require(isHandler[msg.sender], "caller is not a registered action handler");
    _;
  }

  modifier onlyHandlersOrOwner() {
    require(
      isOwner() || isHandler[msg.sender],
      "caller is not a registered action handler nor an owner"
    );
    _;
  }

  /**
   * @dev set up revenue pool
   * @param _prepaidCardManager the address of the PrepaidCardManager contract
   * @param _gsMasterCopy is masterCopy address
   * @param _gsProxyFactory is gnosis proxy factory address.
   * @param _payableTokens are a list of payable token supported by the revenue
   * pool
   * @param _merchantFeeReceiver the address that receives the merchant fees
   * @param _merchantFeePercentage the numerator of a decimals 8 fraction that
   * represents the merchant fee percentage that is charged for each merchant
   * payment
   * @param _merchantRegistrationFeeInSPEND the amount in SPEND that is charged
   * for a merchant to register
   */
  function setup(
    address _exchangeAddress,
    address payable _prepaidCardManager,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address[] calldata _payableTokens,
    address payable _merchantFeeReceiver,
    uint256 _merchantFeePercentage,
    uint256 _merchantRegistrationFeeInSPEND
  ) external onlyOwner {
    require(_merchantFeeReceiver != address(0), "merchantFeeReceiver not set");
    require(
      _merchantRegistrationFeeInSPEND > 0,
      "merchantRegistrationFeeInSPEND is not set"
    );
    // setup gnosis safe address
    MerchantManager.setup(_gsMasterCopy, _gsProxyFactory);

    exchangeAddress = _exchangeAddress;
    prepaidCardManager = _prepaidCardManager;
    merchantFeeReceiver = _merchantFeeReceiver;
    merchantFeePercentage = _merchantFeePercentage;
    merchantRegistrationFeeInSPEND = _merchantRegistrationFeeInSPEND;
    // set token list payable.
    for (uint256 i = 0; i < _payableTokens.length; i++) {
      _addPayableToken(_payableTokens[i]);
    }
    emit Setup();
  }

  /**
   * @dev add action handler to revenue pool
   *
   */
  function addHandler(address handler, string calldata action)
    external
    onlyOwner
    returns (bool)
  {
    actions[action] = handler;
    isHandler[handler] = true;
    emit HandlerAdded(handler, action);
    return true;
  }

  function removeHandler(string calldata action)
    external
    onlyOwner
    returns (bool)
  {
    address handler = actions[action];
    if (handler != address(0)) {
      delete actions[action];
      delete isHandler[handler];
      emit HandlerRemoved(handler, action);
    }
    return true;
  }

  function addMerchant(address merchantAddress, string calldata infoDID)
    external
    onlyHandlersOrOwner
    returns (address)
  {
    return registerMerchant(merchantAddress, infoDID);
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   * This will interrogate and perform the requested action from the prepaid
   * card using the token amount sent.
   * @param from - who transfer token (should from prepaid card).
   * @param amount - number token customer pay for merchant.
   * @param data - merchant safe and infoDID in encode format.
   */
  function onTokenTransfer(
    address payable from,
    uint256 amount,
    bytes calldata data
  ) external isValidToken returns (bool) {
    require(merchantFeeReceiver != address(0), "merchantFeeReciever not set");
    // The Revenue pool can only receive funds from prepaid cards
    PrepaidCardManager prepaidCardMgr = PrepaidCardManager(prepaidCardManager);
    (address issuer, , , , , ) = prepaidCardMgr.cardDetails(from);
    require(issuer != address(0), "Caller is not a prepaid card");

    (
      uint256 spendAmount,
      uint256 requestedRate,
      string memory actionName,
      bytes memory actionData
    ) = abi.decode(data, (uint256, uint256, string, bytes));
    Action memory action =
      makeAction(
        actionName,
        from,
        msg.sender,
        amount,
        spendAmount,
        requestedRate,
        actionData
      );

    return dispatchAction(action);
  }

  /**
   * @dev merchant claims revenue with their safe
   * @param payableToken address of payable token
   * @param amount amount in payable token
   */
  function claimRevenue(address payableToken, uint256 amount)
    external
    onlyMerchantSafe
    returns (bool)
  {
    return _claimRevenue(msg.sender, payableToken, amount);
  }

  /**
   * @dev get the list of tokens that a merchant has collected revenue in
   * @param merchantSafe the safe of the merchant to query
   */
  function revenueTokens(address merchantSafe)
    external
    view
    returns (address[] memory)
  {
    return merchantSafes[merchantSafe].tokens.enumerate();
  }

  /**
   * @dev get the unclaimed revenue for a merchant in a specific token
   * @param merchantSafe the safe of the merchant to query
   * @param token the particular token to check for revenue against
   */
  function revenueBalance(address merchantSafe, address token)
    external
    view
    returns (uint256)
  {
    return merchantSafes[merchantSafe].balance[token];
  }

  /**
   * @dev the decimals to use for the merchant fee percentage (the denominator of
   * the fraction used for the merchant fee percentage)
   */
  function merchantFeeDecimals() public pure returns (uint8) {
    return 8;
  }

  function makeAction(
    string memory actionName,
    address payable prepaidCard,
    address issuingToken,
    uint256 tokenAmount,
    uint256 spendAmount,
    uint256 requestedRate,
    bytes memory actionData
  ) internal pure returns (Action memory) {
    bytes32 nameHash = keccak256(abi.encodePacked(actionName));
    return
      Action(
        actionName,
        prepaidCard,
        issuingToken,
        tokenAmount,
        spendAmount,
        requestedRate,
        nameHash,
        actionData
      );
  }

  function dispatchAction(Action memory action) internal returns (bool) {
    validatePayment(
      action.issuingToken,
      action.tokenAmount,
      action.spendAmount,
      action.requestedRate
    );

    address handler = actions[action.name];
    require(address(handler) != address(0), "no handler for action");

    IERC677(action.issuingToken).transferAndCall(
      handler,
      action.tokenAmount,
      abi.encode(action.prepaidCard, action.spendAmount, action.data)
    );
    return true;
  }

  function addToMerchantBalance(
    address merchantSafe,
    address token,
    uint256 amount
  ) external onlyHandlers returns (uint256) {
    uint256 balance = merchantSafes[merchantSafe].balance[token];
    merchantSafes[merchantSafe].balance[token] = balance.add(amount);
    merchantSafes[merchantSafe].tokens.add(token);
    return merchantSafes[merchantSafe].balance[token];
  }

  /**
   * @dev merchant claim token
   * @param merchantSafe address of merchant
   * @param token address of payable token
   * @param amount amount in payable token
   */
  function _claimRevenue(
    address merchantSafe,
    address token,
    uint256 amount
  ) internal isValidTokenAddress(token) returns (bool) {
    // ensure enough token for redeem
    uint256 balance = merchantSafes[merchantSafe].balance[token];
    require(amount <= balance, "Insufficient funds");

    // unlock token of merchant
    balance = balance.sub(amount);

    // update new balance
    merchantSafes[merchantSafe].balance[token] = balance;

    // transfer payable token from revenue pool to merchant's safe address. The
    // merchant's safe address is a gnosis safe contract, created by
    // registerMerchant(), so this is a trusted contract transfer
    IERC677(token).transfer(merchantSafe, amount);

    emit MerchantClaim(merchantSafe, token, amount);
    return true;
  }

  function validatePayment(
    address token,
    uint256 tokenAmount,
    uint256 spendAmount,
    uint256 requestedRate
  ) internal view returns (bool) {
    Exchange exchange = Exchange(exchangeAddress);
    uint256 expectedTokenAmount =
      exchange.convertFromSpendWithRate(token, spendAmount, requestedRate);
    require(
      expectedTokenAmount == tokenAmount,
      "amount received does not match requested rate"
    );
    require(
      exchange.isAllowableRate(token, requestedRate),
      "requested rate is beyond the allowable bounds"
    );
    return true;
  }
}
