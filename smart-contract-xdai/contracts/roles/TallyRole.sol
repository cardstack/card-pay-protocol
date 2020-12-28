pragma solidity ^0.5.17;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

contract TallyRole is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal tally;

    /**
     * @dev Throws if called by any account other than the tally.
     */
    modifier onlyTallys() {
        require(tally.contains(_msgSender()), "Tally: caller is not the tally");
        _;
    }

    function addTally(address _tally) public onlyOwner returns (bool) {
        return _addTally(_tally);
    }

    function _addTally(address _tally) internal returns (bool) {
        tally.add(_tally);
        return true;
    }

    function removeTally(address _tally) public onlyOwner returns (bool) {
        return _removeTally(_tally);
    }

    function _removeTally(address _tally) internal returns (bool) {
        tally.remove(_tally);
        return true;
    }

    function getTallys() public view returns (address[] memory) {
        return tally.enumerate();
    }
}
