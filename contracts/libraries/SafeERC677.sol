pragma solidity ^0.8.9;
pragma abicoder v1;
import "../token/IERC677.sol";

library SafeERC677 {
  function safeTransferAndCall(
    IERC677 token,
    address to,
    uint256 value,
    bytes memory data
  ) internal {
    bool result = token.transferAndCall(to, value, data);
    require(result, "safeTransferAndCall failed");
  }
}
