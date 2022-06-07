pragma solidity ^0.8.9;
pragma abicoder v1;

import "./ISPEND.sol";
import "../core/Versionable.sol";
import "../roles/SPENDMinterRole.sol";
import "../VersionManager.sol";

contract SPEND is Versionable, ISPEND, SPENDMinterRole {
  event Setup();

  mapping(address => uint256) public _balances;

  uint256 private _totalSupply;
  address public versionManager;

  function initialize(address owner) external initializer {
    initializeMinterRole(owner);
  }

  function setup(address _versionManager) external onlyOwner returns (bool) {
    require(_versionManager != address(0), "versionManager not set");

    versionManager = _versionManager;
    emit Setup();
    return true;
  }

  function mint(address account, uint256 amount)
    external
    override
    onlyMinter
    returns (bool)
  {
    _mint(account, amount);
    return true;
  }

  function burn(address account, uint256 amount)
    external
    override
    onlyMinter
    returns (bool)
  {
    _burn(account, amount);
    return true;
  }

  /**
   * @dev Returns the name of the token.
   */
  function name() external pure returns (string memory) {
    return "SPEND Token";
  }

  /**
   * @dev Returns the symbol of the token, usually a shorter version of the
   * name.
   */
  function symbol() external pure returns (string memory) {
    return "SPEND";
  }

  /**
   * @dev Returns the number of decimals used to get its user representation.
   * For example, if `decimals` equals `2`, a balance of `505` tokens should
   * be displayed to a user as `5,05` (`505 / 10 ** 2`).
   *
   * Tokens usually opt for a value of 18, imitating the relationship between
   * Ether and Wei. This is the value {ERC20} uses, unless {_setupDecimals} is
   * called.
   *
   * NOTE: This information is only used for _display_ purposes: it in
   * no way affects any of the arithmetic of the contract, including
   * {IERC20-balanceOf} and {IERC20-transfer}.
   */
  function decimals() external pure returns (uint8) {
    return 0;
  }

  /**
   * @dev See {IERC20-totalSupply}.
   */
  function totalSupply() external view override returns (uint256) {
    return _totalSupply;
  }

  /**
   * @dev See {IERC20-balanceOf}.
   */
  function balanceOf(address account) external view override returns (uint256) {
    return _balances[account];
  }

  function _mint(address account, uint256 amount) internal {
    require(account != address(0), "cannot mint to zero address");

    _totalSupply = _totalSupply + amount;
    _balances[account] = _balances[account] + amount;
    emit Mint(account, amount);
  }

  function _burn(address account, uint256 amount) internal {
    require(account != address(0), "cannot burn from zero address");
    require(_balances[account] >= amount, "burn amount exceeds balance");

    _balances[account] = _balances[account] - amount;

    _totalSupply = _totalSupply - amount;
    emit Burn(account, amount);
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
