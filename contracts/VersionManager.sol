pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";

contract VersionManager is Ownable {
  string public version;

  event VersionUpdate(string version);

  function initialize(address owner) public initializer {
    // this is the version of the protocol that this contract is being
    // introduced at.
    version = "0.8.3";
    Ownable.initialize(owner);
  }

  function setVersion(string calldata _version) external onlyOwner {
    version = _version;
    emit VersionUpdate(version);
  }
}
