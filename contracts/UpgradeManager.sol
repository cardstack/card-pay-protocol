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

  uint256 public nonce;

  EnumerableSetUpgradeable.AddressSet internal upgradeProposers;
  address public versionManager;

  string[] public contractIds;
  EnumerableSetUpgradeable.AddressSet internal proxies;
  mapping(string => address) public proxyAddresses; // contract id <=> proxy address
  mapping(address => address) internal proxyAdmins; // proxy address <=> proxy admin contract address

  EnumerableSetUpgradeable.AddressSet internal contractsWithPendingChanges;
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

  modifier onlyProposers() {
    if (upgradeProposers.contains(msg.sender)) {
      _;
    } else {
      revert("Caller is not proposer");
    }
  }

  /**
   * @dev set up the contract
   * @param  _upgradeProposers the set of addresses allowed to propose upgrades
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

  function getPendingChanges() external view returns (address[] memory) {
    return contractsWithPendingChanges.values();
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

    _verifyOwnership(_proxyAddress, _proxyAdminAddress);

    contractIds.push(_contractId);
    proxies.add(_proxyAddress);
    proxyAddresses[_contractId] = _proxyAddress;
    proxyAdmins[_proxyAddress] = _proxyAdminAddress;
    emit ProxyAdopted(_contractId, _proxyAddress);
  }

  function proposeUpgrade(
    string memory _contractId,
    address _implementationAddress
  ) external onlyProposers {
    bytes memory encodedCall = "";
    _propose(_contractId, _implementationAddress, encodedCall);
  }

  function proposeUpgradeAndCall(
    string memory _contractId,
    address _implementationAddress,
    bytes calldata encodedCall
  ) external onlyProposers {
    _propose(_contractId, _implementationAddress, encodedCall);
  }

  function proposeCall(string memory _contractId, bytes calldata encodedCall)
    external
    onlyProposers
  {
    _propose(_contractId, SENTINEL_ADDRESS, encodedCall);
  }

  function withdrawChanges(string calldata _contractId) external onlyProposers {
    address proxyAddress = proxyAddresses[_contractId];
    contractsWithPendingChanges.remove(proxyAddress);
    encodedCallData[proxyAddress] = "";
    upgradeAddresses[proxyAddress] = address(0);
  }

  function upgradeProtocol(string calldata newVersion, uint256 _nonce)
    external
    onlyOwner
  {
    require(_nonce == nonce, "Invalid nonce");
    uint256 count = contractsWithPendingChanges.length();
    for (uint256 i; i < count; i++) {
      address proxyAddress = contractsWithPendingChanges.at(0);
      _applyChanges(proxyAddress);
      contractsWithPendingChanges.remove(proxyAddress);
    }

    VersionManager(versionManager).setVersion(newVersion);
  }

  function call(string calldata _contractId, bytes calldata encodedCall)
    external
    onlyOwner
  {
    // solhint-disable-next-line avoid-low-level-calls
    (bool success, ) = proxyAddresses[_contractId].call(encodedCall);
    require(success, "call failed");
  }

  function _verifyOwnership(address _proxyAddress, address _proxyAdminAddress)
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

  function _applyChanges(address _proxyAddress) private {
    assert(_proxyAddress != address(0));
    address proxyAdminAddress = proxyAdmins[_proxyAddress];
    assert(proxyAdminAddress != address(0));
    address newImplementationAddress = upgradeAddresses[_proxyAddress];
    assert(newImplementationAddress != address(0));

    bytes memory encodedCall = encodedCallData[_proxyAddress];

    if (newImplementationAddress == SENTINEL_ADDRESS) {
      // solhint-disable-next-line avoid-low-level-calls
      (bool success, ) = _proxyAddress.call(encodedCall);
      require(success, "call failed");
    } else {
      IProxyAdmin proxyAdmin = IProxyAdmin(proxyAdminAddress);

      if (encodedCall.length == 0) {
        proxyAdmin.upgrade(_proxyAddress, newImplementationAddress);
      } else {
        proxyAdmin.upgradeAndCall(
          _proxyAddress,
          newImplementationAddress,
          encodedCallData[_proxyAddress]
        );
      }
    }

    encodedCallData[_proxyAddress] = "";
    upgradeAddresses[_proxyAddress] = address(0);
  }

  function _propose(
    string memory _contractId,
    address _implementationAddress,
    bytes memory encodedCall
  ) private {
    address proxyAddress = proxyAddresses[_contractId];
    require(
      !contractsWithPendingChanges.contains(proxyAddress),
      "Upgrade already proposed, withdraw first"
    );
    contractsWithPendingChanges.add(proxyAddress);
    upgradeAddresses[proxyAddress] = _implementationAddress;
    encodedCallData[proxyAddress] = encodedCall;

    nonce++;

    emit ChangesProposed(_contractId, _implementationAddress, encodedCall);
  }
}
