pragma solidity ^0.5.17; 

contract SimpleExecutor {
    function executeCall(address to, uint256 value, bytes memory data, uint256 txGas) 
        internal 
        returns(bool success) 
    {
        assembly {
            success := call(txGas, to, value, add(data, 0x20), mload(data), 0, 0)
        }
    } 
}
