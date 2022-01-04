pragma solidity ^0.8.9;
pragma abicoder v1;

contract FakeRewardManager {
  bytes4 internal constant EIP1271_MAGIC_VALUE = 0x20c13b0b;

  function isValidSignature(
    bytes memory, /* data */
    bytes memory /* signature */
  ) public view returns (bytes4) {
    return EIP1271_MAGIC_VALUE;
  }

  function isValidToken(
    address /* token */
  ) public view returns (bytes4) {
    return EIP1271_MAGIC_VALUE;
  }
}
