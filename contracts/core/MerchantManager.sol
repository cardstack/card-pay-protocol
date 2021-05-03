pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";

import "./Safe.sol";
import "../roles/TallyRole.sol";

contract MerchantManager is TallyRole, Safe {
  using EnumerableSet for EnumerableSet.AddressSet;

  event MerchantCreation(address merchantOwner, address merchant);

  struct Merchant {
    bool register;
    // offchain id
    string merchantId;
    // mapping from token address to number token belongs of the merchant.
    mapping(address => uint256) lockTotal;
  }

  mapping(address => Merchant) internal merchants;

  function setup(address _gsMasterCopy, address _gsProxyFactory) internal {
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
  }

  // TODO this function returns whether a safe address is a merchant safe
  // address we'll likely need to hold a mapping of merchants to safes, and have
  // a function to tell us if a merchant address itself is a reigstered merchant
  // (much like how we deal with suppliers in the BridgeUtils contract)
  function isMerchant(address merchantAddr) public view returns (bool) {
    return merchants[merchantAddr].register;
  }

  function registerMerchant(address merchantOwner, string calldata merchantId)
    external
    onlyTally
    returns (address)
  {
    require(merchantOwner != address(0), "zero address not allowed");

    address merchant = createSafe(merchantOwner);

    merchants[merchant].register = true;
    merchants[merchant].merchantId = merchantId;

    emit MerchantCreation(merchantOwner, merchant);

    return merchant;
  }
}
