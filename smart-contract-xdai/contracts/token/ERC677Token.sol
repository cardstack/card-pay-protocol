pragma solidity 0.5.17;

import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "./ERC677TransferReceiver.sol";
import "./IERC677.sol";

/**
 * @dev reference from https://github.com/smartcontractkit/LinkToken
 */
contract ERC677Token is IERC677, ERC20Detailed, ERC20Mintable, ERC20Burnable {
    
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) public ERC20Detailed(_name, _symbol, _decimals) {}

    function contractFallBack(
        address _from,
        address _to,
        uint256 _value,
        bytes memory _data
    ) private {
        ERC677TransferReceiver receiver = ERC677TransferReceiver(_to);
        receiver.onTokenTransfer(_from, _value, _data);
    }

    function transferAndCall(
        address _to,
        uint256 _value,
        bytes memory _data
    ) public returns (bool) {
        bool result = super.transfer(_to, _value);
        if (!result) return false;

        emit Transfer(msg.sender, _to, _value, _data);

        if (isContract(_to)) {
            contractFallBack(msg.sender, _to, _value, _data);
        }

        return true;
    }

    /**
     * @dev use util from openzeppelin contract
     */
    function isContract(address account) internal view returns (bool) {
        // According to EIP-1052, 0x0 is the value returned for not-yet created accounts
        // and 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470 is returned
        // for accounts without code, i.e. `keccak256('')`
        bytes32 codehash;

        bytes32 accountHash = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            codehash := extcodehash(account)
        }
        return (codehash != accountHash && codehash != 0x0);
    }
}
