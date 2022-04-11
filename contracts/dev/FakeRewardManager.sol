pragma solidity ^0.8.9;
pragma abicoder v1;

contract FakeRewardManager {
  // keccak256 hash of the “isValidSignature(bytes,bytes)“, with the first argument deviating from the specification’s bytes32, due
  // to needing compatibility with gnosis safe which also deviates from the spec in this way
  bytes4 internal constant EIP1271_MAGIC_VALUE = 0x20c13b0b;

  function isValidSignature(
    bytes memory, /* data */
    bytes memory /* signature */
  ) public pure returns (bytes4) {
    return EIP1271_MAGIC_VALUE;
  }

  function isValidToken(
    address /* token */
  ) public pure returns (bytes4) {
    return EIP1271_MAGIC_VALUE;
  }
}
