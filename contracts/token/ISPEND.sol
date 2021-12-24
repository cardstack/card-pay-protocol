pragma solidity ^0.7.6;

interface ISPEND {
  /**
   * @dev Returns the amount of tokens in existence.
   */
  function totalSupply() external view returns (uint256);

  /**
   * @dev Returns the amount of tokens owned by `account`.
   */
  function balanceOf(address account) external view returns (uint256);

  /**
   * @dev mint token for account, only call by minters
   */
  function mint(address account, uint256 amount) external returns (bool);

  /**
   * @dev burn token for account, only call by minters
   */
  function burn(address account, uint256 amount) external returns (bool);

  event Mint(address account, uint256 amount);

  event Burn(address account, uint256 amount);
}
