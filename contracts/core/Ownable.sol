pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract Ownable is OwnableUpgradeable {
  // This function cannot be called from inheriting contracts due to https://github.com/OpenZeppelin/openzeppelin-contracts/pull/3006
  // Instead, call OwnableInitialize directly from the overriden initilizaer
  function initialize(address owner) public virtual initializer {
    OwnableInitialize(owner);
  }

  // solhint-disable-next-line func-name-mixedcase
  function OwnableInitialize(address owner) internal onlyInitializing {
    __Ownable_init();
    if (_msgSender() != owner) {
      _transferOwnership(owner);
    }
  }

  // add padding as storage layout changed in OZ contracts v4
  uint256[1] private ____gap_Ownable;
}
