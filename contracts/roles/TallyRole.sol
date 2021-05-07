pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/utils/EnumerableSet.sol";

contract TallyRole is Ownable {
  using EnumerableSet for EnumerableSet.AddressSet;

  EnumerableSet.AddressSet internal tally;

  event TallyAdded(address indexed tally);
  event TallyRemoved(address indexed tally);

  /**
   * @dev Throws if called by any account other than the tally.
   */
  modifier onlyTallyOrOwner() {
    require(
      tally.contains(_msgSender()) || isOwner(),
      "caller is not tally or owner"
    );
    _;
  }

  function addTally(address _tally) public onlyOwner returns (bool) {
    return _addTally(_tally);
  }

  function removeTally(address _tally) public onlyOwner returns (bool) {
    return _removeTally(_tally);
  }

  function getTallys() public view returns (address[] memory) {
    return tally.enumerate();
  }

  function _addTally(address _tally) internal returns (bool) {
    tally.add(_tally);
    emit TallyAdded(_tally);
    return true;
  }

  function _removeTally(address _tally) internal returns (bool) {
    tally.remove(_tally);
    emit TallyRemoved(_tally);
    return true;
  }

  uint256[50] private ____gap;
}
