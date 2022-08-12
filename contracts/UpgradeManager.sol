pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./core/Ownable.sol";
import "./VersionManager.sol";
import "./interfaces/IProxyAdmin.sol";

contract UpgradeManager is Ownable, ReentrancyGuardUpgradeable {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  struct AdoptedContract {
    string id;
    address proxyAdmin;
    bytes encodedCall;
    address upgradeAddress;
  }

  uint256 public constant MAXIMUM_CONTRACTS = 100;

  uint256 public nonce;

  EnumerableSetUpgradeable.AddressSet internal upgradeProposers;
  address public versionManager;

  EnumerableSetUpgradeable.AddressSet internal proxies;
  EnumerableSetUpgradeable.AddressSet internal proxiesWithPendingChanges;
  mapping(address => AdoptedContract) public adoptedContractsByProxyAddress; // proxy address <=> AdoptedContract struct
  mapping(string => address) public adoptedContractAddresses; // contract id <=> proxy address

  event Setup();
  event ProposerAdded(address indexed proposer);
  event ProposerRemoved(address indexed proposer);
  event ContractAdopted(
    string indexed contractId,
    address indexed proxyAddress
  );
  event ContractDisowned(
    string indexed contractId,
    address indexed proxyAddress
  );
  event ChangesProposed(
    string indexed contractId,
    address indexed implementationAddress,
    bytes encodedCall
  );
  event ChangesWithdrawn(string indexed contractId);

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
    require(
      Ownable(_versionManager).owner() == address(this),
      "Version manager not owned by this contract"
    );
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

  function getProxiesWithPendingChanges()
    external
    view
    returns (address[] memory)
  {
    return proxiesWithPendingChanges.values();
  }

  function getAdoptedContractId(address _proxyAddress)
    external
    view
    returns (string memory)
  {
    return adoptedContractsByProxyAddress[_proxyAddress].id;
  }

  function getPendingUpgradeAddress(address _proxyAddress)
    external
    view
    returns (address)
  {
    return adoptedContractsByProxyAddress[_proxyAddress].upgradeAddress;
  }

  function getPendingCallData(address _proxyAddress)
    external
    view
    returns (bytes memory)
  {
    return adoptedContractsByProxyAddress[_proxyAddress].encodedCall;
  }

  function addUpgradeProposer(address proposerAddress) external onlyOwner {
    _addUpgradeProposer(proposerAddress);
  }

  function removeUpgradeProposer(address proposerAddress) external onlyOwner {
    upgradeProposers.remove(proposerAddress);
    emit ProposerRemoved(proposerAddress);
  }

  function adoptContract(
    string calldata _contractId,
    address _proxyAddress,
    address _proxyAdminAddress
  ) external onlyOwner {
    require(proxies.length() < MAXIMUM_CONTRACTS, "Too many contracts adopted");

    _verifyOwnership(_proxyAddress, _proxyAdminAddress);

    address existingProxyAddress = adoptedContractAddresses[_contractId];
    require(
      existingProxyAddress == address(0),
      "Contract id already registered"
    );

    require(
      !_isProxyRegisted(_proxyAddress),
      "Proxy already adopted with a different contract id"
    );

    require(bytes(_contractId).length > 0, "Contract id must not be empty");

    proxies.add(_proxyAddress);
    adoptedContractAddresses[_contractId] = _proxyAddress;

    adoptedContractsByProxyAddress[_proxyAddress] = AdoptedContract(
      _contractId,
      _proxyAdminAddress,
      "",
      address(0)
    );

    emit ContractAdopted(_contractId, _proxyAddress);
  }

  function call(string calldata _contractId, bytes calldata encodedCall)
    external
    onlyOwner
  {
    _call(adoptedContractAddresses[_contractId], encodedCall);
  }

  function upgradeProtocol(string calldata _newVersion, uint256 _nonce)
    external
    onlyOwner
    nonReentrant
  {
    require(_nonce == nonce, "Invalid nonce");
    uint256 count = proxiesWithPendingChanges.length();
    for (uint256 i = 0; i < count; i++) {
      // Note: always access first item because we are removing from the set after
      // applying changes
      address proxyAddress = proxiesWithPendingChanges.at(0);

      _applyChanges(proxyAddress);
      _resetChanges(proxyAddress);
    }

    VersionManager(versionManager).setVersion(_newVersion);

    nonce++;
  }

  function disown(string calldata _contractId, address _newOwner)
    external
    onlyOwner
  {
    address proxyAddress = adoptedContractAddresses[_contractId];
    require(proxyAddress != address(0), "Unknown proxy");

    _resetChanges(proxyAddress);

    proxies.remove(proxyAddress);
    delete adoptedContractsByProxyAddress[proxyAddress];
    delete adoptedContractAddresses[_contractId];

    Ownable(proxyAddress).transferOwnership(_newOwner);

    emit ContractDisowned(_contractId, proxyAddress);

    nonce++;
  }

  // When disowning a contract, the proxyAdmin is not changed, and the ownership of the proxyAdmin is not changed.
  // This is because the proxyAdmin is usually shared between multiple proxies.
  // This function allows changing the proxyAdmin for a specific contract so that it can be
  // upgraded externally if use with the UpgradeManager is no longer desired
  function changeProxyAdmin(
    address _proxyAdminAddress,
    address _proxyAddress,
    address _newAdmin
  ) external onlyOwner {
    require(
      !_isProxyRegisted(_proxyAddress),
      "Cannot change proxy admin for owned contract"
    );
    IProxyAdmin(_proxyAdminAddress).changeProxyAdmin(_proxyAddress, _newAdmin);
  }

  // This allows transferring ownership of a proxy admin after the proxies it controls have been
  // disowned
  function disownProxyAdmin(address _proxyAdminAddress, address _newOwner)
    external
    onlyOwner
  {
    IProxyAdmin(_proxyAdminAddress).transferOwnership(_newOwner);
  }

  // just in case of accidentally trying to make the contract own itself
  // e.g. in a script for example
  function transferOwnership(address newOwner) public override onlyOwner {
    require(newOwner != address(0), "Ownable: new owner is the zero address");
    require(newOwner != address(this), "Ownable: new owner is this contract");
    _transferOwnership(newOwner);
  }

  function renounceOwnership() public view override onlyOwner {
    revert("Ownable: cannot renounce ownership");
  }

  function selfUpgrade(address _newImplementation, address _proxyAdminAddress)
    external
    onlyOwner
  {
    // Note: isContract() is not guaranteed to return an accurate value, never use it to provide an assurance of security, this
    // is just a last line of defence against footgun
    require(
      AddressUpgradeable.isContract(_newImplementation),
      "Implementation address is not a contract"
    );

    IProxyAdmin(_proxyAdminAddress).upgrade(address(this), _newImplementation);
  }

  function proposeUpgrade(
    string calldata _contractId,
    address _implementationAddress
  ) external onlyProposers {
    bytes memory encodedCall = "";
    _propose(_contractId, _implementationAddress, encodedCall);
  }

  function proposeUpgradeAndCall(
    string calldata _contractId,
    address _implementationAddress,
    bytes calldata encodedCall
  ) external onlyProposers {
    _propose(_contractId, _implementationAddress, encodedCall);
  }

  function proposeCall(string calldata _contractId, bytes calldata encodedCall)
    external
    onlyProposers
  {
    _propose(_contractId, address(0), encodedCall);
  }

  function withdrawChanges(string calldata _contractId) external onlyProposers {
    address proxyAddress = adoptedContractAddresses[_contractId];
    _resetChanges(proxyAddress);
    emit ChangesWithdrawn(_contractId);
    nonce++;
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
    AdoptedContract storage adoptedContract = adoptedContractsByProxyAddress[
      _proxyAddress
    ];

    if (adoptedContract.upgradeAddress == address(0)) {
      // solhint-disable-next-line avoid-low-level-calls
      (bool success, ) = _proxyAddress.call(adoptedContract.encodedCall);
      require(success, "call failed");
    } else {
      IProxyAdmin proxyAdmin = IProxyAdmin(adoptedContract.proxyAdmin);

      // This doesn't use the proxyAdmin upgradeAndCall method because with that method,
      // the msg.sender is the ProxyAdmin not this contract, and this contract is the
      // owner so setup calls with fail unless this contract calls directly.
      // The upgrade and call are still atomic, a failure in the call will revert the
      // upgrade as it is all the same transaction
      proxyAdmin.upgrade(_proxyAddress, adoptedContract.upgradeAddress);
      if (adoptedContract.encodedCall.length > 0) {
        _call(_proxyAddress, adoptedContract.encodedCall);
      }
    }
  }

  function _propose(
    string calldata _contractId,
    address _implementationAddress,
    bytes memory encodedCall
  ) private {
    address proxyAddress = adoptedContractAddresses[_contractId];

    require(proxyAddress != address(0), "Unknown contract id");

    require(
      !proxiesWithPendingChanges.contains(proxyAddress),
      "Upgrade already proposed, withdraw first"
    );

    AdoptedContract storage adoptedContract = adoptedContractsByProxyAddress[
      proxyAddress
    ];
    address currentImplementationAddress = IProxyAdmin(
      adoptedContract.proxyAdmin
    ).getProxyImplementation(proxyAddress);

    require(
      currentImplementationAddress != _implementationAddress,
      "Implementation address unchanged"
    );

    if (_implementationAddress != address(0)) {
      // Note: isContract() is not guaranteed to return an accurate value, never use it to provide an assurance of security, this
      // is just a last line of defence against footgun
      require(
        AddressUpgradeable.isContract(_implementationAddress),
        "Implementation address is not a contract"
      );
    }

    proxiesWithPendingChanges.add(proxyAddress);

    adoptedContract.upgradeAddress = _implementationAddress;
    adoptedContract.encodedCall = encodedCall;

    nonce++;

    emit ChangesProposed(_contractId, _implementationAddress, encodedCall);
  }

  function _call(address _proxyAddress, bytes memory encodedCall) private {
    // solhint-disable-next-line avoid-low-level-calls
    (bool success, ) = _proxyAddress.call(encodedCall);
    require(success, "call failed");
  }

  function _resetChanges(address _proxyAddress) private {
    AdoptedContract storage adoptedContract = adoptedContractsByProxyAddress[
      _proxyAddress
    ];
    adoptedContract.upgradeAddress = address(0);
    adoptedContract.encodedCall = "";
    proxiesWithPendingChanges.remove(_proxyAddress);
  }

  function _isProxyRegisted(address _proxyAddress) private view returns (bool) {
    return bytes(adoptedContractsByProxyAddress[_proxyAddress].id).length != 0;
  }
}
