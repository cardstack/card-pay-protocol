pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";

import "./core/Versionable.sol";
import "./PrepaidCardManager.sol";
import "./ActionDispatcher.sol";

contract PrepaidCardMarket is Ownable, Versionable {
  using SafeMath for uint256;
  using EnumerableSet for EnumerableSet.AddressSet;

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
  event ItemsSet(
    address[] prepaidCards,
    address issuer,
    address issuingToken,
    uint256[] faceValues,
    string customizationDID,
    bytes32[] skus
  );
  event ItemsRemoved(address[] prepaidCards, address issuer, bytes32[] skus);
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

  bytes4 internal constant EIP1271_MAGIC_VALUE = 0x20c13b0b;
  bytes4 internal constant SWAP_OWNER = 0xe318b52b; //swapOwner(address,address,address)
  address public prepaidCardManagerAddress;
  address public actionDispatcher;
  address public provisioner;

  mapping(bytes32 => EnumerableSet.AddressSet) internal inventory; // sku => prepaid card addresses
  mapping(bytes32 => uint256) public asks; // sku => ask price (in issuing token)
  mapping(bytes32 => SKU) public skus; // sku => sku data
  mapping(address => address) public provisionedCards; // prepaid card => EOA
  mapping(bytes32 => bool) internal signatures;

  modifier onlyHandlers() {
    require(
      ActionDispatcher(actionDispatcher).isHandler(msg.sender),
      "caller is not a registered action handler"
    );
    _;
  }
  modifier onlyProvisionerOrOwner() {
    require(
      isOwner() || msg.sender == provisioner,
      "caller is not the provisioner nor the owner"
    );
    _;
  }

  function setup(
    address _prepaidCardManager,
    address _actionDispatcher,
    address _provisioner
  ) external onlyOwner {
    prepaidCardManagerAddress = _prepaidCardManager;
    provisioner = _provisioner;
    actionDispatcher = _actionDispatcher;

    emit Setup();
  }

  function setItems(address issuer, address[] calldata prepaidCards)
    external
    onlyHandlers
    returns (bool)
  {
    (address issuingToken, string memory customizationDID) =
      validateItems(issuer, prepaidCards);
    PrepaidCardManager prepaidCardManager =
      PrepaidCardManager(prepaidCardManagerAddress);
    bytes32[] memory _skus = new bytes32[](prepaidCards.length);
    uint256[] memory faceValues = new uint256[](prepaidCards.length);
    for (uint256 i = 0; i < prepaidCards.length; i++) {
      uint256 faceValue = prepaidCardManager.faceValue(prepaidCards[i]);
      bytes32 sku = getSKU(issuer, issuingToken, faceValue, customizationDID);
      if (skus[sku].issuer == address(0)) {
        skus[sku].issuer = issuer;
        skus[sku].issuingToken = issuingToken;
        skus[sku].faceValue = faceValue;
        skus[sku].customizationDID = customizationDID;
      }
      inventory[sku].add(prepaidCards[i]);
      _skus[i] = sku;
      faceValues[i] = faceValue;
    }
    emit ItemsSet(
      prepaidCards,
      issuer,
      issuingToken,
      faceValues,
      customizationDID,
      _skus
    );
    return true;
  }

  function removeItems(address issuer, address[] calldata prepaidCards)
    external
    onlyHandlers
    returns (bool)
  {
    validateItems(issuer, prepaidCards);
    bytes32[] memory _skus = new bytes32[](prepaidCards.length);
    for (uint256 i = 0; i < prepaidCards.length; i++) {
      bytes memory signature = contractSignature(prepaidCards[i], issuer);
      bytes32 sku = skuForPrepaidCard(prepaidCards[i]);
      _skus[i] = sku;
      inventory[sku].remove(prepaidCards[i]);
      signatures[keccak256(signature)] = true;
      // note that this is not a token transfer, so linter concerns around reetrancy
      // after transfer are not valid
      PrepaidCardManager(prepaidCardManagerAddress).transfer(
        address(uint160(prepaidCards[i])),
        issuer,
        signature
      );
      signatures[keccak256(signature)] = false;
    }
    emit ItemsRemoved(prepaidCards, issuer, _skus);
    return true;
  }

  // Until we allow the purchase of prepaid cards directly from this contract, the
  // ask price will need to be enforced off-chain (in the card wallet app)
  function setAsk(
    address issuer,
    bytes32 sku,
    uint256 askPrice // a "0" askPrice removes the SKU from the market
  ) external onlyHandlers returns (bool) {
    require(skus[sku].issuer != address(0), "Non-existent SKU");
    require(skus[sku].issuer == issuer, "SKU not owned by issuer");
    asks[sku] = askPrice;

    emit AskSet(issuer, skus[sku].issuingToken, sku, askPrice);
    return true;
  }

  function provisionPrepaidCard(address customer, bytes32 sku)
    external
    onlyProvisionerOrOwner
    returns (bool)
  {
    require(inventory[sku].length() > 0, "No more prepaid cards for sku");
    require(asks[sku] > 0, "No ask price for sku");

    address prepaidCard = inventory[sku].get(0);
    provisionedCards[prepaidCard] = customer;
    bytes memory signature = contractSignature(prepaidCard, customer);
    signatures[keccak256(signature)] = true;
    inventory[sku].remove(prepaidCard);
    // note that this is not a token transfer, so linter concerns around reetrancy
    // after transfer are not valid
    PrepaidCardManager(prepaidCardManagerAddress).transfer(
      address(uint160(prepaidCard)),
      customer,
      signature
    );
    signatures[keccak256(signature)] = false;

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

  function skuForPrepaidCard(address prepaidCard)
    public
    view
    returns (bytes32)
  {
    PrepaidCardManager prepaidCardManager =
      PrepaidCardManager(prepaidCardManagerAddress);
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
    return inventory[sku].enumerate();
  }

  function contractSignature(address prepaidCard, address newOwner)
    internal
    view
    returns (bytes memory)
  {
    return
      abi.encodePacked(
        keccak256(
          abi.encodePacked(address(this), prepaidCard, newOwner, block.number)
        )
      );
  }

  function isValidSignature(bytes memory data, bytes memory signature)
    public
    view
    returns (bytes4)
  {
    // bytes4 validSig = 0xdeadbeef;
    // if (
    //   keccak256(abi.encodePacked(signature)) ==
    //   keccak256(abi.encodePacked(validSig))
    // ) {
    //   return EIP1271_MAGIC_VALUE;
    // }
    if (signatures[keccak256(signature)]) {
      return EIP1271_MAGIC_VALUE;
    }
    return bytes4(0);
  }

  function validateItems(address issuer, address[] memory prepaidCards)
    internal
    view
    returns (address issuingToken, string memory customizationDID)
  {
    require(prepaidCards.length > 0, "No prepaid cards provided");
    PrepaidCardManager prepaidCardManager =
      PrepaidCardManager(prepaidCardManagerAddress);
    require(
      prepaidCards.length <= prepaidCardManager.MAXIMUM_NUMBER_OF_CARD(),
      "Too many prepaid cards"
    );

    (, issuingToken, , customizationDID, , ) = prepaidCardManager.cardDetails(
      prepaidCards[0]
    );
    for (uint256 i = 0; i < prepaidCards.length; i++) {
      require(
        prepaidCardManager.getPrepaidCardOwner(
          address(uint160(prepaidCards[i]))
        ) == issuer,
        "Issuer is not the owner of the prepaid card"
      );
      require(
        prepaidCardManager.getPrepaidCardIssuer(
          address(uint160(prepaidCards[i]))
        ) == issuer,
        "Issuer is not the actual issuer of the prepaid card"
      );
      require(
        !prepaidCardManager.hasBeenUsed(prepaidCards[i]),
        "Prepaid card has been used"
      );
      (
        ,
        address currentIssuingToken,
        ,
        string memory currentCustomizationDID,
        ,

      ) = prepaidCardManager.cardDetails(prepaidCards[0]);
      require(
        issuingToken == currentIssuingToken &&
          keccak256(abi.encodePacked(customizationDID)) ==
          keccak256(abi.encodePacked(currentCustomizationDID)),
        "Prepaid cards details do not match"
      );
    }
  }
}
