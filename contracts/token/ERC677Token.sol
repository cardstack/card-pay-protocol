pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/token/ERC20/ERC20Mintable.sol";
import "@openzeppelin/contract-upgradeable/contracts/token/ERC20/ERC20Burnable.sol";
import "./ERC677TransferReceiver.sol";
import "./IERC677.sol";


/**
 * @dev reference from https://github.com/smartcontractkit/LinkToken
 */
contract ERC677Token is IERC677, ERC20Burnable, ERC20Mintable {

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    function initialize(string memory name, string memory symbol, uint8 decimals, address minter) public initializer {
        _name = name;
        _symbol = symbol;
        _decimals = decimals;
        initialize(minter);
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
     * @dev Returns the name of the token.
     */
    function name() public view returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view returns (uint8) {
        return _decimals;
    }

    function contractFallBack(
        address _from,
        address _to,
        uint256 _value,
        bytes memory _data
    ) private {
        ERC677TransferReceiver receiver = ERC677TransferReceiver(_to);
        receiver.onTokenTransfer(_from, _value, _data);
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
