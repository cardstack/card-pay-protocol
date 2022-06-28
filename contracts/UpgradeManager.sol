pragma solidity ^0.8.9;
pragma abicoder v1;

import "./core/Ownable.sol";
import "./VersionManager.sol";
import "./interfaces/IProxyAdmin.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "hardhat/console.sol";

contract UpgradeManager is Ownable {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  address public constant SENTINEL_ADDRESS = address(0x1);

  EnumerableSetUpgradeable.AddressSet internal upgradeProposers;
  address public versionManager;

  string[] public contractIds;
  EnumerableSetUpgradeable.AddressSet internal proxies;
  mapping(string => address) public proxyAddresses; // contract id <=> proxy address
  mapping(address => address) internal proxyAdmins; // proxy address <=> proxy admin contract address

  string[] public pendingChanges;
  mapping(address => address) public upgradeAddresses; // proxy address <=> proposed implementation address
  mapping(address => bytes) public encodedCallData; // proxy address <=> encoded call data

  event Setup();
  event ProposerAdded(address indexed proposer);
  event ProposerRemoved(address indexed proposer);
  event ProxyAdopted(string indexed contractId, address indexed proxyAddress);
  event ChangesProposed(
    string indexed contractId,
    address indexed implementationAddress,
    bytes encodedCall
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

  function addUpgradeProposer(address proposerAddress) external onlyOwner {
    _addUpgradeProposer(proposerAddress);
  }

  function removeUpgradeProposer(address proposerAddress) external onlyOwner {
    upgradeProposers.remove(proposerAddress);
    emit ProposerRemoved(proposerAddress);
  }

  function adoptProxy(
    string memory _contractId,
    address _proxyAddress,
    address _proxyAdminAddress
  ) external onlyOwner {
    require(
      proxyAddresses[_contractId] == address(0),
      "Contract id already registered"
    );

    verifyOwnership(_proxyAddress, _proxyAdminAddress);

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
    bytes memory encodedCall = "";
    _propose(_contractId, _implementationAddress, encodedCall);
  }

  function proposeUpgradeAndCall(
    string memory _contractId,
    address _implementationAddress,
    bytes calldata encodedCall
  ) external {
    _propose(_contractId, _implementationAddress, encodedCall);
  }

  function proposeCall(string memory _contractId, bytes calldata encodedCall)
    external
  {
    _propose(_contractId, SENTINEL_ADDRESS, encodedCall);
  }

  function upgradeProtocol(string calldata newVersion) external onlyOwner {
    for (uint256 i; i < pendingChanges.length; i++) {
      _applyChanges(pendingChanges[i]);
    }

    delete pendingChanges;

    VersionManager(versionManager).setVersion(newVersion);
  }

  function call(string calldata _contractId, bytes calldata encodedCall)
    external
  {
    (bool success, ) = proxyAddresses[_contractId].call(encodedCall);
    require(success, "call failed");
  }

  function verifyOwnership(address _proxyAddress, address _proxyAdminAddress)
    private
    view
  {
    require(
      IProxyAdmin(_proxyAdminAddress).owner() == address(this),
      "Must be owner of ProxyAdmin to adopt"
    );

    require(
      Ownable(_proxyAddress).owner() == address(this),
      "Must be owner of contract to adopt"
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

  function _addUpgradeProposer(address proposerAddress) private {
    upgradeProposers.add(proposerAddress);
    emit ProposerAdded(proposerAddress);
  }

  function _applyChanges(string memory _contractId) private {
    address proxyAddress = proxyAddresses[_contractId];
    assert(proxyAddress != address(0));
    address proxyAdminAddress = proxyAdmins[proxyAddress];
    assert(proxyAdminAddress != address(0));
    address newImplementationAddress = upgradeAddresses[proxyAddress];
    assert(newImplementationAddress != address(0));

    bytes memory encodedCall = encodedCallData[proxyAddress];

    if (newImplementationAddress == SENTINEL_ADDRESS) {
      (bool success, ) = proxyAddress.call(encodedCall);
      require(success, "call failed");
    } else {
      IProxyAdmin proxyAdmin = IProxyAdmin(proxyAdminAddress);

      if (encodedCall.length == 0) {
        proxyAdmin.upgrade(proxyAddress, newImplementationAddress);
      } else {
        proxyAdmin.upgradeAndCall(
          proxyAddress,
          newImplementationAddress,
          encodedCallData[proxyAddress]
        );
      }
    }

    encodedCallData[proxyAddress] = "";
    upgradeAddresses[proxyAddress] = address(0);
  }

  function _propose(
    string memory _contractId,
    address _implementationAddress,
    bytes memory encodedCall
  ) private {
    pendingChanges.push(_contractId);

    upgradeAddresses[proxyAddresses[_contractId]] = _implementationAddress;
    encodedCallData[proxyAddresses[_contractId]] = encodedCall;

    emit ChangesProposed(_contractId, _implementationAddress, encodedCall);
  }
}
