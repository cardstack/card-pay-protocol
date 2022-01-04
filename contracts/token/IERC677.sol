pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IERC677 is IERC20Upgradeable {
  function transferAndCall(
    address to,
    uint256 value,
    bytes memory data
  ) external returns (bool ok);

  function symbol() external view returns (string memory);

  function decimals() external view returns (uint8);

  event Transfer(
    address indexed from,
    address indexed to,
    uint256 value,
    bytes data
  );
}
