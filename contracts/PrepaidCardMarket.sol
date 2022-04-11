pragma solidity ^0.8.9;
pragma abicoder v1;

import "./core/Ownable.sol";

import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./core/Versionable.sol";
import "./IPrepaidCardMarket.sol";
import "./PrepaidCardManager.sol";
import "./ActionDispatcher.sol";
import "./VersionManager.sol";

contract PrepaidCardMarket is Ownable, Versionable, IPrepaidCardMarket {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  struct SKU {
    address issuer;
    address issuingToken;
    uint256 faceValue;
    string customizationDID;
  }
  struct Reservation {
    bytes32 reservationId;
    address customer;
    uint256 blockNumber;
  }

  event Setup();
  event ItemSet(
    address prepaidCard,
    address issuer,
    address issuingToken,
    uint256 faceValue,
    string customizationDID,
    bytes32 sku
  );
  event ItemRemoved(address prepaidCard, address issuer, bytes32 sku);
  event AskSet(
    address issuer,
    address issuingToken,
    bytes32 sku,
    uint256 askPrice
  );
  event ProvisionedPrepaidCard(
    address prepaidCard,
    address customer,
    bytes32 sku,
    uint256 askPrice
  );
  event PausedToggled(bool paused);

  // keccak256 hash of the “isValidSignature(bytes,bytes)“, with the first argument deviating from the specification’s bytes32, due
  // to needing compatibility with gnosis safe which also deviates from the spec in this way
  bytes4 internal constant EIP1271_MAGIC_VALUE = 0x20c13b0b;
  bytes4 internal constant SWAP_OWNER = 0xe318b52b; //swapOwner(address,address,address)
  uint256 internal nonce;
  address public prepaidCardManagerAddress;
  address public actionDispatcher;
  address public provisioner;

  mapping(bytes32 => EnumerableSetUpgradeable.AddressSet) internal inventory; // sku => prepaid card addresses
  mapping(bytes32 => uint256) public asks; // sku => ask price (in issuing token)
  mapping(bytes32 => SKU) public skus; // sku => sku data
  mapping(address => address) public provisionedCards; // prepaid card => EOA
  mapping(bytes32 => bool) internal signatures;
  bool public paused;
  address public versionManager;

  modifier onlyHandlersOrPrepaidCardManager() {
    require(
      ActionDispatcher(actionDispatcher).isHandler(msg.sender) ||
        msg.sender == prepaidCardManagerAddress,
      "caller is not a registered action handler or PrepaidCardManager"
    );
    _;
  }
  modifier onlyHandlers() {
    require(
      ActionDispatcher(actionDispatcher).isHandler(msg.sender),
      "caller is not a registered action handler"
    );
    _;
  }
  modifier onlyProvisionerOrOwner() {
    require(
      (owner() == _msgSender()) || msg.sender == provisioner,
      "caller is not the provisioner nor the owner"
    );
    _;
  }

  function initialize(address owner) public override initializer {
    nonce = 0;
    paused = false;
    OwnableInitialize(owner);
  }

  function setup(
    address _prepaidCardManager,
    address _actionDispatcher,
    address _provisioner,
    address _versionManager
  ) external onlyOwner {
    require(_prepaidCardManager != address(0), "prepaidCardManager not set");
    require(_actionDispatcher != address(0), "actionDispatcher not set");
    require(_provisioner != address(0), "provisioner not set");
    require(_versionManager != address(0), "versionManager not set");

    prepaidCardManagerAddress = _prepaidCardManager;
    provisioner = _provisioner;
    actionDispatcher = _actionDispatcher;
    versionManager = _versionManager;

    emit Setup();
  }

  function setPaused(bool _paused) external onlyOwner {
    paused = _paused;
    emit PausedToggled(_paused);
  }

  function setItem(address issuer, address prepaidCard)
    external
    override
    onlyHandlersOrPrepaidCardManager
    returns (bool)
  {
    (address issuingToken, string memory customizationDID) = validateItem(
      issuer,
      prepaidCard
    );
    PrepaidCardManager prepaidCardManager = PrepaidCardManager(
      prepaidCardManagerAddress
    );
    uint256 faceValue = prepaidCardManager.faceValue(prepaidCard);
    bytes32 sku = getSKU(issuer, issuingToken, faceValue, customizationDID);
    if (skus[sku].issuer == address(0)) {
      skus[sku].issuer = issuer;
      skus[sku].issuingToken = issuingToken;
      skus[sku].faceValue = faceValue;
      skus[sku].customizationDID = customizationDID;
    }
    inventory[sku].add(prepaidCard);
    emit ItemSet(
      prepaidCard,
      issuer,
      issuingToken,
      faceValue,
      customizationDID,
      sku
    );
    return true;
  }

  function removeItems(address issuer, address[] calldata prepaidCards)
    external
    override
    onlyHandlers
    returns (bool)
  {
    PrepaidCardManager prepaidCardManager = PrepaidCardManager(
      prepaidCardManagerAddress
    );
    require(
      prepaidCards.length <= prepaidCardManager.MAXIMUM_NUMBER_OF_CARD(),
      "too many prepaid cards"
    );
    for (uint256 i = 0; i < prepaidCards.length; i++) {
      validateItem(issuer, prepaidCards[i]);
      bytes memory signature = contractSignature(prepaidCards[i], issuer);
      bytes32 sku = skuForPrepaidCard(prepaidCards[i]);
      inventory[sku].remove(prepaidCards[i]);
      signatures[keccak256(signature)] = true;
      // note that this is not a token transfer, so linter concerns around reetrancy
      // after transfer are not valid
      /* solhint-disable reentrancy */
      prepaidCardManager.transfer(payable(prepaidCards[i]), issuer, signature);
      signatures[keccak256(signature)] = false;
      /* solhint-enable reentrancy */
      emit ItemRemoved(prepaidCards[i], issuer, sku);
    }
    return true;
  }

  // Until we allow the purchase of prepaid cards directly from this contract, the
  // ask price will need to be enforced off-chain (in the card wallet app)
  function setAsk(
    address issuer,
    bytes32 sku,
    uint256 askPrice // a "0" askPrice removes the SKU from the market
  ) external override onlyHandlers returns (bool) {
    require(skus[sku].issuer != address(0), "Non-existent SKU");
    require(skus[sku].issuer == issuer, "SKU not owned by issuer");
    asks[sku] = askPrice;

    emit AskSet(issuer, skus[sku].issuingToken, sku, askPrice);
    return true;
  }

  function provisionPrepaidCard(address customer, bytes32 sku)
    external
    override
    onlyProvisionerOrOwner
    returns (bool)
  {
    require(!paused, "Contract is paused");
    require(inventory[sku].length() > 0, "No more prepaid cards for sku");
    require(asks[sku] > 0, "No ask price for sku");

    address prepaidCard = inventory[sku].at(0);
    provisionedCards[prepaidCard] = customer;
    bytes memory signature = contractSignature(prepaidCard, customer);
    signatures[keccak256(signature)] = true;
    inventory[sku].remove(prepaidCard);
    // note that this is not a token transfer, so linter concerns around reetrancy
    // after transfer are not valid
    /* solhint-disable reentrancy */
    PrepaidCardManager(prepaidCardManagerAddress).transfer(
      payable(prepaidCard),
      customer,
      signature
    );
    signatures[keccak256(signature)] = false;
    /* solhint-enable reentrancy */

    emit ProvisionedPrepaidCard(prepaidCard, customer, sku, asks[sku]);
    return true;
  }

  function getSKU(
    address issuer,
    address token,
    uint256 faceValue,
    string memory customizationDID
  ) public pure returns (bytes32) {
    return
      keccak256(abi.encodePacked(issuer, token, faceValue, customizationDID));
  }

  function getSkuInfo(bytes32 sku)
    external
    view
    override
    returns (
      address issuer,
      address issuingToken,
      uint256 faceValue,
      string memory customizationDID
    )
  {
    issuer = skus[sku].issuer;
    issuingToken = skus[sku].issuingToken;
    faceValue = skus[sku].faceValue;
    customizationDID = skus[sku].customizationDID;
  }

  function skuForPrepaidCard(address prepaidCard)
    public
    view
    returns (bytes32)
  {
    PrepaidCardManager prepaidCardManager = PrepaidCardManager(
      prepaidCardManagerAddress
    );
    require(
      !prepaidCardManager.hasBeenUsed(prepaidCard),
      "Can't get SKU for used prepaid card"
    );
    (
      address issuer,
      address issuingToken,
      ,
      string memory customizationDID,
      ,

    ) = prepaidCardManager.cardDetails(prepaidCard);
    uint256 faceValue = prepaidCardManager.faceValue(prepaidCard);
    return getSKU(issuer, issuingToken, faceValue, customizationDID);
  }

  function getInventory(bytes32 sku) public view returns (address[] memory) {
    return inventory[sku].values();
  }

  function getQuantity(bytes32 sku) public view returns (uint256) {
    return inventory[sku].length();
  }

  function contractSignature(address prepaidCard, address newOwner)
    internal
    returns (bytes memory)
  {
    nonce++;
    return
      abi.encodePacked(
        keccak256(abi.encodePacked(address(this), prepaidCard, newOwner, nonce))
      );
  }

  function isValidSignature(
    bytes memory, // data
    bytes memory signature
  ) public view returns (bytes4) {
    return
      signatures[keccak256(signature)] && !paused
        ? EIP1271_MAGIC_VALUE
        : bytes4(0);
  }

  function validateItem(address issuer, address prepaidCard)
    internal
    view
    returns (address issuingToken, string memory customizationDID)
  {
    PrepaidCardManager prepaidCardManager = PrepaidCardManager(
      prepaidCardManagerAddress
    );
    address expectedIssuer;
    (expectedIssuer, issuingToken, , customizationDID, , ) = prepaidCardManager
      .cardDetails(prepaidCard);

    require(
      prepaidCardManager.getPrepaidCardOwner(payable(prepaidCard)) ==
        address(this),
      "Market contract does not own the prepaid card"
    );
    require(
      expectedIssuer == issuer,
      "Specified issuer is not the issuer of the prepaid card"
    );
    require(
      !prepaidCardManager.hasBeenUsed(prepaidCard),
      "Prepaid card has been used"
    );
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
