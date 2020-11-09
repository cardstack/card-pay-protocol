pragma solidity ^0.5.0;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/access/Roles.sol";

contract Tally is Ownable {
    using Roles for Roles.Role;

    Roles.Role private tally;

    /**
     * @dev Throws if called by any account other than the tally.
     */
    modifier onlyTally() {
        require(tally.has(_msgSender()), "Tally: caller is not the tally");
        _;
    }

    function addTally(address _tally) public onlyOwner returns(bool) {
        return _addTally(_tally);
    }

    function _addTally(address _tally) internal returns(bool) {
        tally.add(_tally);
        return true;
    }

    function removeTally(address _tally) public onlyOwner returns(bool) {
        return _removeTally(_tally);
    }

    function _removeTally(address _tally) internal returns(bool) {
        tally.remove(_tally);
        return true;
    }
}