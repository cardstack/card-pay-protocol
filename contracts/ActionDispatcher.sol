pragma solidity ^0.8.9;
pragma abicoder v1;

import "./core/Ownable.sol";
import "./token/IERC677.sol";
import "./TokenManager.sol";
import "./Exchange.sol";
import "./core/Versionable.sol";
import "./PrepaidCardManager.sol";
import "./VersionManager.sol";

contract ActionDispatcher is Ownable, Versionable {
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

  address public exchangeAddress;
  address payable public prepaidCardManager;
  address public tokenManager;
  mapping(string => address) public actions;
  mapping(address => bool) public isHandler;
  address public versionManager;

  event Setup();
  event HandlerAdded(address handler, string action);
  event HandlerRemoved(address handler, string action);

  /**
   * @param _exchangeAddress the address of the Exchange contract
   * @param _prepaidCardManager the address of the PrepaidCardManager contract
   */
  function setup(
    address _tokenManager,
    address _exchangeAddress,
    address payable _prepaidCardManager,
    address _versionManager
  ) external onlyOwner {
    require(_tokenManager != address(0), "tokenManager not set");
    require(_exchangeAddress != address(0), "exchangeAddress not set");
    require(_prepaidCardManager != address(0), "prepaidCardManager not set");
    require(_versionManager != address(0), "versionManager not set");
    tokenManager = _tokenManager;
    exchangeAddress = _exchangeAddress;
    prepaidCardManager = _prepaidCardManager;
    versionManager = _versionManager;
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
  ) external returns (bool) {
    require(
      TokenManager(tokenManager).isValidToken(msg.sender),
      "calling token is unaccepted"
    );

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
    Action memory action = makeAction(
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

  function validatePayment(
    address token,
    uint256 tokenAmount,
    uint256 spendAmount,
    uint256 requestedRate
  ) internal view returns (bool) {
    Exchange exchange = Exchange(exchangeAddress);
    uint256 expectedTokenAmount = exchange.convertFromSpendWithRate(
      token,
      spendAmount,
      requestedRate
    );
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

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
