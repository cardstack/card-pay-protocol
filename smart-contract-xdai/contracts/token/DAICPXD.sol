pragma solidity ^0.5.0;

import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./IERC677.sol";
import "./ERC677TransferReceiver.sol";

/**
 * @dev reference from https://github.com/rnsdomains/erc677
 */
contract DAICPXD is IERC677, ERC20Detailed, ERC20 {
    constructor(uint initialSupply) ERC20Detailed("DAICPXD Token", "DAICPXD", 18) public {
        _mint(msg.sender, initialSupply);
    }

    function transferAndCall(address _to, uint _value, bytes memory _data) public returns (bool) {
        bool result = super.transfer(_to, _value);
        if (!result) return false;

        emit Transfer(msg.sender, _to, _value, _data);

        ERC677TransferReceiver receiver = ERC677TransferReceiver(_to);
        receiver.tokenFallback(msg.sender, _value, _data);
        
        return true;
    }    
}