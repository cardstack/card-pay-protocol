pragma solidity 0.5.17;

/// @dev mock BridgeUtils
contract BridgeUtilsMock {
    /// @dev update token payable for pool and prepaid manager.
    function updateToken(address tokenAddr) external returns (bool) {
        return true;
    }

    /// @dev update supplier data by supplier. 
    function updateSupplier(
        string calldata name,
        string calldata profileUrl,
        string calldata brandName,
        string calldata brandProfileUrl
    ) external returns (bool) {
        return true;
    }

    /// @dev registerSupplier
    function registerSupplier(address ownerAddr) external returns (address) {
        return msg.sender;
    }
}
