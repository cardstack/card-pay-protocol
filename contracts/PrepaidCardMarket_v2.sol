pragma solidity ^0.8.9;
pragma abicoder v1;

import "./core/Ownable.sol";

import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./core/Versionable.sol";
import "./IPrepaidCardMarket.sol";
import "./PrepaidCardManager.sol";
import "./ActionDispatcher.sol";
import "./VersionManager.sol";
import "./TokenManager.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";

contract PrepaidCardMarketV2 is Ownable, Versionable {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  struct SKU {
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

  event Setup();
  event InventoryAdded(
    address issuer,
    uint256 amount,
    address token,
    address safe
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

  // TODO: Add removeInventory() function
  // removeInventory (function you call on a safe) - how many tokens you wanna take back
  // msg.sender will be the safe
  // token address will be the 2nd parameter
  // balance should be larger or eq to the amount
  // token transfer into the msg.sender (erc677 transfer)
  // emit event remove from inventory (safe, issuer, token, amount)

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

    // caution: block gas limit could be too high for big arrays
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
