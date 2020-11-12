pragma solidity ^0.5.17;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";


contract MinterRole is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet internal minter;

    /**
     * @dev Throws if called by any account other than the minter.
     */
    modifier onlyMinter() {
        require(
            minter.contains(_msgSender()),
            "Minter: caller is not the minter"
        );
        _;
    }

    function addMinter(address _minter) public onlyOwner returns (bool) {
        return _addMinter(_minter);
    }

    function _addMinter(address _minter) internal returns (bool) {
        minter.add(_minter);
        return true;
    }

    function removeMinter(address _minter) public onlyOwner returns (bool) {
        return _removeMinter(_minter);
    }

    function _removeMinter(address _minter) internal returns (bool) {
        minter.remove(_minter);
        return true;
    }

    function getMinters() public view returns (address[] memory) {
        return minter.enumerate();
    }
}
