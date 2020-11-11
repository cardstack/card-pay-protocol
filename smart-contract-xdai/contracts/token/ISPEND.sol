pragma solidity ^0.5.17;


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
    function mint(address account, uint amount) external returns(bool);

    /**
     * @dev burn token for account, only call by minters
     */
    function burn(address account, uint amount) external returns(bool);

    event Mint(address account, uint amount);

    event Burn(address account, uint amount);
}