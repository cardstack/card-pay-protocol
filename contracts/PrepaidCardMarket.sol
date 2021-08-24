pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";

import "./core/Versionable.sol";

contract PrepaidCardMarket is Ownable, Versionable {
  using EnumerableSet for EnumerableSet.AddressSet;

  bytes4 internal constant EIP1271_MAGIC_VALUE = 0x20c13b0b;
  bytes4 internal constant SWAP_OWNER = 0xe318b52b; //swapOwner(address,address,address)

  struct Inventory {
    uint256 askPrice;
    EnumerableSet.AddressSet prepaidCards;
  }

  // issuer address => issuing token => face value => customization => Inventory
  mapping(address => mapping(address => mapping(uint256 => mapping(string => Inventory))))
    internal inventory;

  mapping(address => address) public purchasers; // prepaid card => EOA

  function isValidSignature(bytes memory data, bytes memory signature)
    public
    view
    returns (bytes4)
  {
    bytes4 validSig = 0xdeadbeef;
    if (
      keccak256(abi.encodePacked(signature)) ==
      keccak256(abi.encodePacked(validSig))
    ) {
      return EIP1271_MAGIC_VALUE;
    }
    return bytes4(0);
  }
}
