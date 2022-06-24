pragma solidity ^0.8.9;
pragma abicoder v1;

import "./core/Ownable.sol";
import "./VersionManager.sol";
import "./interfaces/IProxyAdmin.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "hardhat/console.sol";

contract UpgradeManager is Ownable {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  EnumerableSetUpgradeable.AddressSet internal upgradeProposers;
  address public versionManager;

  string[] public contractIds;
  EnumerableSetUpgradeable.AddressSet internal proxies;
  mapping(string => address) public proxyAddresses; // contract id <=> proxy address
  mapping(address => address) internal proxyAdmins; // proxy address <=> proxy admin contract address

  string[] public pendingUpgrades;
  mapping(address => address) public upgradeAddresses; // proxy address <=> proposed implementation address

  event Setup();
  event ProposerAdded(address indexed proposer);
  event ProposerRemoved(address indexed proposer);
  event ProxyAdopted(string indexed contractId, address indexed proxyAddress);
  event UpgradeProposed(
    string indexed contractId,
    address indexed implementationAddress
  );

  /**
   * @dev set up the contract
   * @param  _versionManager the address of the version manager
   */
  function setup(address[] memory _upgradeProposers, address _versionManager)
    external
    onlyOwner
  {
    for (uint256 i = 0; i < _upgradeProposers.length; i++) {
      _addUpgradeProposer(_upgradeProposers[i]);
    }

    require(_versionManager != address(0), "versionManager not set");
    versionManager = _versionManager;
    emit Setup();
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }

  function getUpgradeProposers() external view returns (address[] memory) {
    return upgradeProposers.values();
  }

  function getProxies() external view returns (address[] memory) {
    return proxies.values();
  }

  function _addUpgradeProposer(address proposerAddress) internal {
    upgradeProposers.add(proposerAddress);
    emit ProposerAdded(proposerAddress);
  }

  function removeUpgradeProposer(address proposerAddress) external onlyOwner {
    upgradeProposers.remove(proposerAddress);
    emit ProposerRemoved(proposerAddress);
  }

  function verifyProxyAdminOwnership(
    address _proxyAddress,
    address _proxyAdminAddress
  ) private view {
    IProxyAdmin proxyAdmin = IProxyAdmin(_proxyAdminAddress);
    require(
      proxyAdmin.owner() == address(this),
      "Must be owner of ProxyAdmin to adopt"
    );

    // This uses staticcall because there is no way to just get a false return
    // if the result is negative, the transaction reverts, so we detect that and
    // give a better error message
    (bool success, bytes memory returnData) = _proxyAdminAddress.staticcall(
      abi.encodeWithSignature("getProxyAdmin(address)", _proxyAddress)
    );

    require(success, "Call to determine proxy admin ownership of proxy failed");

    address returnedAddress = abi.decode(returnData, (address));

    require(
      returnedAddress == _proxyAdminAddress,
      "Proxy admin is not admin of this proxy"
    );
  }

  function adoptProxy(
    string memory _contractId,
    address _proxyAddress,
    address _proxyAdminAddress
  ) external onlyOwner {
    verifyProxyAdminOwnership(_proxyAddress, _proxyAdminAddress);

    contractIds.push(_contractId);
    proxies.add(_proxyAddress);
    proxyAddresses[_contractId] = _proxyAddress;
    proxyAdmins[_proxyAddress] = _proxyAdminAddress;
    emit ProxyAdopted(_contractId, _proxyAddress);
  }

  function proposeUpgrade(
    string memory _contractId,
    address _implementationAddress
  ) external {
    pendingUpgrades.push(_contractId);

    upgradeAddresses[proxyAddresses[_contractId]] = _implementationAddress;

    emit UpgradeProposed(_contractId, _implementationAddress);
  }

  function upgradeProtocol() external {
    for (uint256 i; i < pendingUpgrades.length; i++) {
      _upgradeContract(pendingUpgrades[i]);
    }
  }

  function _upgradeContract(string memory _contractId) private {
    address proxyAddress = proxyAddresses[_contractId];
    assert(proxyAddress != address(0));
    address proxyAdminAddress = proxyAdmins[proxyAddress];
    assert(proxyAdminAddress != address(0));
    address newImplementationAddress = upgradeAddresses[proxyAddress];
    assert(newImplementationAddress != address(0));

    IProxyAdmin proxyAdmin = IProxyAdmin(proxyAdminAddress);

    proxyAdmin.upgrade(proxyAddress, newImplementationAddress);
  }
}
