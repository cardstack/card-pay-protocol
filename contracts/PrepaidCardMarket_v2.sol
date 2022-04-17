pragma solidity ^0.8.9;
pragma abicoder v1;

import "./core/Ownable.sol";

import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./core/Versionable.sol";
import "./IPrepaidCardMarket.sol";
import "./PrepaidCardManager.sol";
import "./ActionDispatcher.sol";
import "./VersionManager.sol";
import "./TokenManager.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "hardhat/console.sol";

contract PrepaidCardMarketV2 is Ownable, Versionable {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
  using SafeERC20Upgradeable for IERC677;

  struct SKU {
    address issuerSafe;
    address issuer;
    address issuingToken;
    uint256 faceValue;
    string customizationDID;
  }

  address public prepaidCardManagerAddress;
  address public tokenManager;
  address public provisioner;
  address public versionManager;
  mapping(address => mapping(address => uint256)) public balance; // issuer safe address -> token -> balance
  mapping(address => address) public issuer; // issuer safe address -> issuer EOA
  mapping(bytes32 => SKU) public skus; // sku => sku data
  mapping(bytes32 => uint256) public asks; // sku => ask price (in issuing token)

  event Setup();
  event InventoryAdded(
    address issuer,
    uint256 amount,
    address token,
    address safe
  );
  event InventoryRemoved(
    address safe,
    address issuer,
    address token,
    uint256 amount
  );
  event SkuAdded(
    address issuer,
    address issuingToken,
    uint256 faceValue,
    string customizationDID
  );
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

  // only owner can call setup
  function setup(
    address _prepaidCardManagerAddress,
    address _provisioner,
    address _tokenManager,
    address _versionManager
  ) external onlyOwner returns (bool) {
    prepaidCardManagerAddress = _prepaidCardManagerAddress;
    provisioner = _provisioner;
    tokenManager = _tokenManager;
    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  // TODO: add a function to add SKUs
  // Allow issuer to set SKUs (face value, DID, token address)
  // mapping between safe and issuer
  // provide face value and DID
  // new mapping sku -> sku data
  // mapping(bytes32 => SKU) public skus; // sku => sku data
  // add a require balance > 0
  // need the token address (another param)
  // function addSKU() external {}

  // TODO: Allow trusted provisioner (will be relay server) to call a method to
  // create a card and transfer it to an EOA by specifying a SKU and target EOA

  // function createPrepaidCard
  // sku, eoa are the inputs
  // from sku you get who's the issuer,
  // tokens to create the

  // additonal createprepaidsignature
  // it is assumed the sender is the issuer but here we don't want this to be the ca
  // add a new function where i can specify who the issuer is. Shoukd only be called by
  // the market conctract
  // add a new property (array) - all the contracts allowerd to create a prepaid card
  // can be AdressSet

  // when a trusted provisioner calls a method to create a card,
  // what will the inputs be

  // when a prepaid card gets created, we need to remove
  // when a card is created and transfered


  function getQuantity(bytes32 sku) public view returns (uint256) {
    PrepaidCardManager prepaidCardManager = PrepaidCardManager(
      prepaidCardManagerAddress
    );

    address token = skus[sku].issuingToken;
    uint256 faceValue = skus[sku].faceValue;
    address issuerSafe = skus[sku].issuerSafe;

    uint256 price = prepaidCardManager.priceForFaceValue(token, faceValue);

    return balance[issuerSafe][token] / price;
  }

  function setAsk(
    address issuerAddress,
    bytes32 sku,
    uint256 askPrice
  ) external returns (bool) {
    require(skus[sku].issuer != address(0), "Non-existent SKU");
    require(skus[sku].issuer == issuerAddress, "SKU not owned by issuer");
    asks[sku] = askPrice;

    emit AskSet(issuerAddress, skus[sku].issuingToken, sku, askPrice);
    return true;
  }

  function addSKU(
    uint256 faceValue,
    string memory customizationDID,
    address token
  ) external returns (bool) {
    require(faceValue > 0, "Face value must be greater than 0");
    require(token != address(0), "Token address must be set");

    address _issuer = issuer[msg.sender];
    require(_issuer != address(0), "Issuer not found.");

    bytes32 sku = getSKU(_issuer, token, faceValue, customizationDID);
    require(skus[sku].issuer == address(0), "SKU already exists");

    skus[sku] = SKU({
      issuerSafe: msg.sender,
      issuer: _issuer,
      issuingToken: token,
      faceValue: faceValue,
      customizationDID: customizationDID
    });

    emit SkuAdded(_issuer, token, faceValue, customizationDID);

    return true;
  }

  function getSKU(
    address issuerAddress, // todo: better name would be just issuer but it shadows the mapping
    address token,
    uint256 faceValue,
    string memory customizationDID
  ) public pure returns (bytes32) {
    return
      keccak256(
        abi.encodePacked(issuerAddress, token, faceValue, customizationDID)
      );
  }

  // COnsider changing "inventory" to "tokens"
  function withdrawTokens(uint256 amount, address token) external {
    address _issuer = issuer[msg.sender];
    require(_issuer != address(0), "Issuer not found");

    uint256 balanceForToken = balance[msg.sender][token];

    require(amount <= balanceForToken, "Insufficient funds for withdrawal");

    balance[msg.sender][token] -= amount;

    IERC677(token).safeTransfer(msg.sender, amount);
    emit InventoryRemoved(msg.sender, _issuer, token, amount);
  }

  function onTokenTransfer(
    address payable from, // safe address
    uint256 amount,
    bytes calldata data
  ) external returns (bool) {
    // Only CARD.CPXD, DAI.CPXD are accepted
    require(
      TokenManager(tokenManager).isValidToken(msg.sender),
      "token is unaccepted"
    );

    address _issuer = abi.decode(data, (address));

    require(_issuer != address(0), "issuer should be provided");

    address[] memory _owners = GnosisSafe(from).getOwners();
    bool _foundOwner = false;

    // Caution: block gas limit could be too high for big arrays
    require(_owners.length < 100, "too many safe owners");

    for (uint256 i = 0; i < _owners.length; i++) {
      if (_owners[i] == _issuer) {
        _foundOwner = true;
        break;
      }
    }

    require(_foundOwner, "issuer is not one of the safe owners");

    balance[from][msg.sender] = balance[from][msg.sender] + amount;
    issuer[from] = _issuer;
    emit InventoryAdded(_issuer, amount, msg.sender, from);

    return true;
  }
}
