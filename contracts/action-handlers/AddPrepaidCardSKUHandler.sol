pragma solidity ^0.8.9;
pragma abicoder v1;

import "../core/Ownable.sol";
import "../core/Versionable.sol";
import "../token/IERC677.sol";
import "../PrepaidCardManager.sol";
import "../PrepaidCardMarketV2.sol";
import "../TokenManager.sol";
import "../IPrepaidCardMarket.sol";
import "../VersionManager.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

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
   *
   * This handles adding the SKU to the market.
   *
   * See AddPrepaidCardSKUHandler in README for more information.
   *
   * @param from the token sender (should be the revenue pool)
   * @param data encoded as: (
   *  address prepaidCard,
   *  uint256 spendAmount,
   *  bytes actionData, encoded as: (
   *    uint256 faceValue,
   *    string customizationDID,
   *    address tokenAddress,
   *    address marketAddress,
   *    address issuerSafe
   *  )
   * )
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

    require(amount == 0, "amount must be 0");

    (address payable prepaidCard, , bytes memory actionData) = abi.decode(
      data,
      (address, uint256, bytes)
    );

    (
      uint256 faceValue,
      string memory customizationDID,
      address tokenAddress,
      address marketAddress,
      address payable issuerSafe
    ) = abi.decode(actionData, (uint256, string, address, address, address));

    // require that the owner of the prepaid card is the same as the owner
    // of the issuer safe
    PrepaidCardManager prepaidCardMgr = PrepaidCardManager(
      prepaidCardManagerAddress
    );

    address prepaidCardOwner = prepaidCardMgr.getPrepaidCardOwner(prepaidCard);
    address[] memory issuerSafeOwners = GnosisSafe(issuerSafe).getOwners();

    bool foundOwner = false;

    // Safety measure to prevent big gas costs on huge arrays
    require(issuerSafeOwners.length < 100, "too many safe owners");

    for (uint256 i = 0; i < issuerSafeOwners.length; i++) {
      if (issuerSafeOwners[i] == prepaidCardOwner) {
        foundOwner = true;
        break;
      }
    }

    require(foundOwner, "owner of the prepaid card does not own issuer safe");

    PrepaidCardMarketV2 prepaidCardMarket = PrepaidCardMarketV2(marketAddress);

    return
      prepaidCardMarket.addSKU(
        issuerSafe,
        faceValue,
        customizationDID,
        tokenAddress
      );
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
