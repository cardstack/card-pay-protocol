pragma solidity ^0.7.6;

import "@openzeppelin/contracts-upgradeable/presets/ERC20PresetMinterPauserUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "./ERC677TransferReceiver.sol";
import "./IERC677.sol";
import "../core/Versionable.sol";

/**
 * @dev reference from https://github.com/smartcontractkit/LinkToken


  This contract is only used in tests, in the real protocol bridged tokens from the tokenbridge contracts are used
 */
contract ERC677Token is IERC677, ERC20PresetMinterPauserUpgradeable {
  function initialize(
    string memory name,
    string memory symbol,
    uint8 decimals,
    address owner
  ) public initializer {
    // lots of initializers to override here, due to owner by default being msg sender
    __Context_init_unchained();
    __AccessControl_init_unchained();
    __ERC20_init_unchained(name, symbol);
    __ERC20Burnable_init_unchained();
    __Pausable_init_unchained();
    __ERC20Pausable_init_unchained();
    __ERC20PresetMinterPauser_init_unchained(name, symbol);

    _setupRole(DEFAULT_ADMIN_ROLE, owner);

    _setupRole(MINTER_ROLE, owner);
    _setupRole(PAUSER_ROLE, owner);

    _setupDecimals(decimals);
  }

  function transferAndCall(
    address _to,
    uint256 _value,
    bytes memory _data
  ) public override returns (bool) {
    bool result = super.transfer(_to, _value);
    if (!result) return false;

    emit Transfer(msg.sender, _to, _value, _data);

    if (AddressUpgradeable.isContract(_to)) {
      contractFallBack(msg.sender, _to, _value, _data);
    }

    return true;
  }

  function symbol()
    public
    view
    override(ERC20Upgradeable, IERC677)
    returns (string memory)
  {
    return ERC20Upgradeable.symbol();
  }

  function decimals()
    public
    view
    override(ERC20Upgradeable, IERC677)
    returns (uint8)
  {
    return ERC20Upgradeable.decimals();
  }

  function contractFallBack(
    address _from,
    address _to,
    uint256 _value,
    bytes memory _data
  ) private {
    ERC677TransferReceiver receiver = ERC677TransferReceiver(_to);
    receiver.onTokenTransfer(_from, _value, _data);
  }

  uint256[50] private ____gap;
}
