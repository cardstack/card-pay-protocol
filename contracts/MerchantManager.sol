pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";

import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./ActionDispatcher.sol";

contract MerchantManager is Ownable, Versionable, Safe {
  event Setup();
  event MerchantCreation(
    address merchant,
    address merchantSafe,
    string infoDID
  );

  struct Merchant {
    address merchantSafe;
    string infoDID;
  }

  mapping(address => address) public merchantSafes; // merchant safe address => merchant address
  mapping(address => Merchant) public merchants; // merchant address => Merchant
  address public actionDispatcher;

  modifier onlyHandlersOrOwner() {
    require(
      isOwner() || ActionDispatcher(actionDispatcher).isHandler(msg.sender),
      "caller is not a registered action handler nor an owner"
    );
    _;
  }

  function setup(
    address _actionDispatcher,
    address _gsMasterCopy,
    address _gsProxyFactory
  ) external onlyOwner {
    actionDispatcher = _actionDispatcher;
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
    emit Setup();
  }

  function isMerchantSafe(address merchantSafe) public view returns (bool) {
    return merchantSafes[merchantSafe] != address(0);
  }

  function registerMerchant(address merchant, string calldata infoDID)
    external
    onlyHandlersOrOwner
    returns (address)
  {
    require(merchant != address(0), "zero address not allowed");

    address merchantSafe = merchants[merchant].merchantSafe;
    require(merchantSafe == address(0), "merchant is already registered");

    merchantSafe = createSafe(merchant);

    merchantSafes[merchantSafe] = merchant;
    merchants[merchant].merchantSafe = merchantSafe;
    merchants[merchant].infoDID = infoDID;

    emit MerchantCreation(merchant, merchantSafe, infoDID);

    return merchantSafe;
  }

  // TODO This is problematic now that we dont use this as a base contract. remove this
  // at our first opportunity
  uint256[50] private ____gap;
}
