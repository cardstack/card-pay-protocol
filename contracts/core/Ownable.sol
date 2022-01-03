pragma solidity ^0.7.6;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract Ownable is OwnableUpgradeable {
  function initialize(address owner) public virtual initializer {
    __Ownable_init();
    if (_msgSender() != owner) {
      transferOwnership(owner);
    }
  }
}
