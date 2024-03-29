pragma solidity ^0.8.9;
pragma abicoder v1;

import "./core/Ownable.sol";

contract VersionManager is Ownable {
  string public version;

  event VersionUpdate(string version);

  function initialize(address owner) external override initializer {
    // this is the version of the protocol that this contract is being
    // introduced at.
    version = "0.8.3";
    OwnableInitialize(owner);
  }

  function setVersion(string calldata _version) external onlyOwner {
    version = _version;
    emit VersionUpdate(version);
  }
}
