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
import "./core/Safe.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "./libraries/SafeERC677.sol";

import "hardhat/console.sol";

contract PrepaidCardMarketV2 is Ownable, Versionable, Safe {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;
  using SafeERC20Upgradeable for IERC677;
  using SafeERC677 for IERC677;

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
  address public exchangeAddress;
  mapping(address => mapping(address => uint256)) public balance; // issuer safe address -> token -> balance
  mapping(address => address) public issuers; // issuer safe address -> issuer EOA
  mapping(bytes32 => SKU) public skus; // sku => sku data
  mapping(bytes32 => uint256) public asks; // sku => ask price (in issuing token)

  bool public paused;

  EnumerableSetUpgradeable.AddressSet internal trustedProvisioners;

  event Setup();

  event TokensDeposited(
    address issuer,
    uint256 amount,
    address token,
    address safe
  );
  event TokensWithdrawn(
    address safe,
    address issuer,
    address token,
    uint256 amount
  );
  event SkuAdded(
    address issuer,
    address issuingToken,
    uint256 faceValue,
    string customizationDID,
    bytes32 sku
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
  event TrustedProvisionerAdded(address token);
  event TrustedProvisionerRemoved(address token);
  event PausedToggled(bool paused);

  function initialize(address owner) public override initializer {
    paused = false;
    OwnableInitialize(owner);
  }

  function setup(
    address _exchangeAddress,
    address _prepaidCardManagerAddress,
    address _provisioner,
    address _tokenManager,
    address[] calldata _trustedProvisioners,
    address _versionManager
  ) external onlyOwner {
    exchangeAddress = _exchangeAddress;
    prepaidCardManagerAddress = _prepaidCardManagerAddress;
    provisioner = _provisioner;
    tokenManager = _tokenManager;
    versionManager = _versionManager;

    for (uint256 i = 0; i < _trustedProvisioners.length; i++) {
      _addTrustedProvisioner(_trustedProvisioners[i]);
    }

    emit Setup();
  }

  function setPaused(bool _paused) external onlyOwner {
    paused = _paused;
    emit PausedToggled(_paused);
  }

  function getTrustedProvisioners() external view returns (address[] memory) {
    return trustedProvisioners.values();
  }

  function _addTrustedProvisioner(address _token) internal {
    trustedProvisioners.add(_token);
    emit TrustedProvisionerAdded(_token);
  }

  function removeTrustedProvisioner(address _token) external onlyOwner {
    trustedProvisioners.remove(_token);
    emit TrustedProvisionerRemoved(_token);
  }

  function provisionPrepaidCard(address customer, bytes32 sku)
    external
    returns (bool)
  {
    require(!paused, "Contract is paused");
    require(
      trustedProvisioners.contains(msg.sender),
      "Only trusted provisioners allowed"
    );
    require(asks[sku] > 0, "Can't provision SKU with 0 askPrice");

    PrepaidCardManager prepaidCardManager = PrepaidCardManager(
      prepaidCardManagerAddress
    );

    address token = skus[sku].issuingToken;
    uint256 faceValue = skus[sku].faceValue;
    string memory customizationDID = skus[sku].customizationDID;
    uint256 priceToCreatePrepaidCard = prepaidCardManager.priceForFaceValue(
      token,
      faceValue
    ); // in Wei

    uint256[] memory issuingTokenAmounts = new uint256[](1);
    uint256[] memory spendAmounts = new uint256[](1);

    issuingTokenAmounts[0] = Exchange(exchangeAddress).convertFromSpend(
      token,
      faceValue
    );

    spendAmounts[0] = faceValue;

    address issuer = skus[sku].issuer;
    address issuerSafe = skus[sku].issuerSafe;

    IERC677(token).safeTransferAndCall(
      prepaidCardManagerAddress,
      priceToCreatePrepaidCard,
      abi.encode(
        customer,
        issuingTokenAmounts,
        spendAmounts,
        customizationDID,
        address(0), // marketAddress - we probably don't need it in this case?
        issuer,
        issuerSafe
      )
    );

    balance[issuerSafe][token] -= priceToCreatePrepaidCard;

    return true;
  }

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
    address issuer,
    bytes32 sku,
    uint256 askPrice
  ) external returns (bool) {
    require(skus[sku].issuer != address(0), "Non-existent SKU");
    require(skus[sku].issuer == issuer, "SKU not owned by issuer");
    asks[sku] = askPrice;

    emit AskSet(issuer, skus[sku].issuingToken, sku, askPrice);
    return true;
  }

  function addSKU(
    uint256 faceValue,
    string memory customizationDID,
    address token
  ) external returns (bool) {
    require(faceValue > 0, "Face value must be greater than 0");
    require(token != address(0), "Token address must be set");

    address _issuer = issuers[msg.sender];
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

    emit SkuAdded(_issuer, token, faceValue, customizationDID, sku);

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

  function withdrawTokens(uint256 amount, address token) external {
    address _issuer = issuers[msg.sender];
    require(_issuer != address(0), "Issuer not found");

    uint256 balanceForToken = balance[msg.sender][token];

    require(amount <= balanceForToken, "Insufficient funds for withdrawal");

    balance[msg.sender][token] -= amount;

    IERC677(token).safeTransfer(msg.sender, amount);

    emit TokensWithdrawn(msg.sender, _issuer, token, amount);
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
    issuers[from] = _issuer;
    emit TokensDeposited(_issuer, amount, msg.sender, from);

    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}