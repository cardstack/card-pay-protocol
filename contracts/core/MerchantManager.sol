pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";

import "./Safe.sol";
import "../roles/TallyRole.sol";

contract MerchantManager is TallyRole, Safe {
  using EnumerableSet for EnumerableSet.AddressSet;

  event MerchantCreation(address merchant, address merchantSafe);
  event MerchantUpdate(address merchant, address merchantSafe);

  struct MerchantSafe {
    bool register;
    address merchant;
    string merchantExternalId; // offchain id
    EnumerableSet.AddressSet tokens;
    // mapping from token address to revenue pool balance for merchant in that
    // token
    mapping(address => uint256) balance;
  }

  mapping(address => MerchantSafe) internal merchantSafes;
  mapping(address => address) internal merchants;

  modifier onlyMerchantSafe() {
    require(isMerchantSafe(msg.sender), "caller is not a merchant safe");
    _;
  }

  function setup(address _gsMasterCopy, address _gsProxyFactory) internal {
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
  }

  function isMerchantSafe(address merchantSafe) public view returns (bool) {
    return merchantSafes[merchantSafe].register;
  }

  function safeForMerchant(address merchant) public view returns (address) {
    return merchants[merchant];
  }

  function registerMerchant(
    address merchant,
    string calldata merchantExternalId
  ) external onlyTallyOrOwner returns (address) {
    require(merchant != address(0), "zero address not allowed");

    address merchantSafe = safeForMerchant(merchant);
    if (merchantSafe != address(0)) {
      merchantSafes[merchantSafe].merchantExternalId = merchantExternalId;
      emit MerchantUpdate(merchant, merchantSafe);
      return merchantSafe;
    }

    merchantSafe = createSafe(merchant);

    merchantSafes[merchantSafe].register = true;
    merchantSafes[merchantSafe].merchant = merchant;
    merchantSafes[merchantSafe].merchantExternalId = merchantExternalId;

    merchants[merchant] = merchantSafe;

    emit MerchantCreation(merchant, merchantSafe);

    return merchantSafe;
  }

  uint256[50] private ____gap;
}
