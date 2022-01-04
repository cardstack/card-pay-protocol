pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

library EnumerableSetUnboundedEnumerable {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  /**
   * @dev Return the entire set in an array
   *
   * WARNING: This operation will copy the entire storage to memory, which can be quite expensive. This is designed
   * to mostly be used by view accessors that are queried without any gas fees. Developers should keep in mind that
   * this function has an unbounded cost, and using it as part of a state-changing function may render the function
   * uncallable if the set grows to a point where copying to memory consumes too much gas to fit in a block.
   */

  function enumerate(EnumerableSetUpgradeable.AddressSet storage set)
    internal
    view
    returns (address[] memory)
  {
    uint256 length = set.length();

    address[] memory addresses = new address[](length);

    for (uint256 i = 0; i < length; i++) {
      addresses[i] = set.at(i);
    }

    return addresses;
  }
}
