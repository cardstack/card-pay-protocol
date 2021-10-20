pragma solidity 0.5.17;

// This contract no longer does anything, but we can't remove it because our
// upgradeable contracts' storage layout would break. If we ever rev the
// protocol in such a way that we can clear our contract state, then we should
// get rid of this contract. For any future contracts, please do not add this to
// your contract inheritance chain.
contract Versionable {
  uint256[50] private ____gap;
}
