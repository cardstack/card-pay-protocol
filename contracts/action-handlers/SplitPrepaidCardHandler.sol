pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Versionable.sol";
import "../core/Ownable.sol";
import "../token/IERC677.sol";
import "../PrepaidCardManager.sol";
import "../TokenManager.sol";
import "../VersionManager.sol";

contract SplitPrepaidCardHandler is Ownable, Versionable {
  address public actionDispatcher;
  address public prepaidCardManagerAddress;
  address public tokenManagerAddress;
  address public defaultMarketAddress;
  address public versionManager;

  event Setup();
  event SplitPrepaidCard(
    address prepaidCard,
    uint256[] issuingTokenAmounts,
    uint256[] spendAmounts,
    address issuingToken,
    address issuer,
    string customizationDID
  );

  function setup(
    address _actionDispatcher,
    address _prepaidCardManager,
    address _tokenManagerAddress,
    address _defaultMarketAddress,
    address _versionManager
  ) external onlyOwner returns (bool) {
    require(_actionDispatcher != address(0), "actionDispatcher not set");
    require(_prepaidCardManager != address(0), "prepaidCardManager not set");
    require(_tokenManagerAddress != address(0), "tokenManagerAddress not set");
    require(
      _defaultMarketAddress != address(0),
      "defaultMarketAddress not set"
    );
    require(_versionManager != address(0), "versionManager not set");

    actionDispatcher = _actionDispatcher;
    prepaidCardManagerAddress = _prepaidCardManager;
    tokenManagerAddress = _tokenManagerAddress;
    defaultMarketAddress = _defaultMarketAddress;
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   * handle using a prepaid card to create more prepaid cards
   * @param from the token sender (should be the revenue pool)
   * @param amount the amount of tokens being transferred
   * @param data the data encoded as (address prepaidCard, uint256 spendAmount, bytes actionData)
   * where actionData is encoded as (uint256[] issuingTokenAmounts, uint256[] spendAmounts, string customizatoinDID, address marketAddress)
   */
  function onTokenTransfer(
    address payable from,
    uint256 amount,
    bytes calldata data
  ) external returns (bool) {
    require(
      TokenManager(tokenManagerAddress).isValidToken(msg.sender),
      "calling token is unaccepted"
    );
    require(
      from == actionDispatcher,
      "can only accept tokens from action dispatcher"
    );
    (address payable prepaidCard, , bytes memory actionData) = abi.decode(
      data,
      (address, uint256, bytes)
    );
    (
      uint256[] memory issuingTokenAmounts,
      uint256[] memory spendAmounts,
      string memory customizationDID,
      address marketAddress
    ) = abi.decode(actionData, (uint256[], uint256[], string, address));
    PrepaidCardManager prepaidCardMgr = PrepaidCardManager(
      prepaidCardManagerAddress
    );
    address owner = prepaidCardMgr.getPrepaidCardOwner(prepaidCard);
    address issuer = prepaidCardMgr.getPrepaidCardIssuer(prepaidCard);
    require(issuer == owner, "only issuer can split card");
    require(
      issuingTokenAmounts.length == spendAmounts.length,
      "the amount arrays have differing lengths"
    );
    prepaidCardMgr.setPrepaidCardUsed(prepaidCard);

    emit SplitPrepaidCard(
      prepaidCard,
      issuingTokenAmounts,
      spendAmounts,
      msg.sender,
      issuer,
      customizationDID
    );

    return
      IERC677(msg.sender).transferAndCall(
        prepaidCardManagerAddress,
        amount,
        abi.encode(
          owner,
          issuingTokenAmounts,
          spendAmounts,
          customizationDID,
          marketAddress == address(0) ? defaultMarketAddress : marketAddress
        )
      );
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
