pragma solidity ^0.8.9;
pragma abicoder v1;

/*
 * Contract interface for receivers of tokens that
 * comply with ERC-677.
 * See https://github.com/ethereum/EIPs/issues/677 for details.
 */
abstract contract ERC677TransferReceiver {
  function onTokenTransfer(
    address from,
    uint256 amount,
    bytes calldata data
  ) external virtual returns (bool);

  uint256[50] private ____gap;
}
