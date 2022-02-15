pragma solidity ^0.8.9;
pragma abicoder v1;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/libraries/MultiSend.sol";

/**
 * @dev this contract is used to consume dependencies that are leveraged in our
   tests. The solidiity compiler will not make available any external deps that
   are not explicitly consumed;
 */
// solhint-disable-next-line no-empty-blocks
contract DevDependenciesGetter {

}
