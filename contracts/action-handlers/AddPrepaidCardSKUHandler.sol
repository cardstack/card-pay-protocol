pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";
import "../core/Versionable.sol";
import "../token/IERC677.sol";
import "../PrepaidCardManager.sol";
import "../PrepaidCardMarket_v2.sol";
import "../TokenManager.sol";
import "../IPrepaidCardMarket.sol";
import "../VersionManager.sol";

contract AddPrepaidCardSKUHandler is Ownable, Versionable {
  address public actionDispatcher;
  address public prepaidCardManagerAddress;
  address public tokenManagerAddress;
  address public versionManager;

  event Setup();

  function setup(
    address _actionDispatcher,
    address _prepaidCardManager,
    address _tokenManagerAddress,
    address _versionManager
  ) external onlyOwner returns (bool) {
    actionDispatcher = _actionDispatcher;
    prepaidCardManagerAddress = _prepaidCardManager;
    tokenManagerAddress = _tokenManagerAddress;
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   * Set SKU in the market contract
   * @param from the token sender (should be the revenue pool ??)
   * @param data the data encoded as
   */
  function onTokenTransfer(
    address payable from,
    uint256, // amount
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

    // What to do with prepaidCard?
    console.log(prepaidCard);

    (
      uint256 faceValue,
      string memory customizationDID,
      address tokenAddress,
      address marketAddress
    ) = abi.decode(actionData, (uint256, string, address, address));

    PrepaidCardMarketV2 prepaidCardMarket = PrepaidCardMarketV2(marketAddress);

    return prepaidCardMarket.addSKU(faceValue, customizationDID, tokenAddress);
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
