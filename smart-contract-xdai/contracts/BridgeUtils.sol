pragma solidity 0.5.17;

import "./core/Safe.sol";
import "./roles/PayableToken.sol";

contract BridgeUtils is Safe {
    event SupplierWallet(address onwer, address wallet);

    struct Supplier {
        string name;
        string profileUrl;
        string brandName;
        string brandProfileUrl;
    }

    mapping(address => Supplier) public supplier;

    address tallyAdmin;
    address public revenuePool;
    address public prepaidCardManager;
    address public tokenBridge;

    constructor(address _tallyAdmin) public {
        tallyAdmin = _tallyAdmin;
    }

    /// TODO: need permission for do this action
    /// @dev only tallyAdmin can call it.
    function setUp(
        address _revenuePool,
        address _prepaidCardManager,
        address _tokenBridge
    ) public returns (bool) {
        require(msg.sender == tallyAdmin);

        revenuePool = _revenuePool;
        prepaidCardManager = _prepaidCardManager;
        tokenBridge = _tokenBridge;

        return true;
    }

    function _updateToken(address tokenAddr) internal returns (bool) {
        // update payable token for token
        PayableToken(revenuePool).addPayableToken(tokenAddr);
        PayableToken(prepaidCardManager).addPayableToken(tokenAddr);
        
        return true;
    }

    /// @dev only `bridge` can call this method.
    function updateToken(address tokenAddr) external returns (bool) {
        require(msg.sender == tokenBridge);

        _updateToken(tokenAddr);

        return true;
    }

    /// @dev update supplier information
    function updateSupplier(
        string calldata name,
        string calldata profileUrl,
        string calldata brandName,
        string calldata brandProfileUrl
    ) external returns (bool) {
        address supplierAddr = msg.sender;

        supplier[supplierAddr].name = name;
        supplier[supplierAddr].profileUrl = profileUrl;
        supplier[supplierAddr].brandName = brandName;
        supplier[supplierAddr].brandProfileUrl = brandProfileUrl;

        return true;
    }

    function _registerSupplier(address ownerAddr) internal returns (address) {
        address safe = createSafe(ownerAddr);
        require(safe != address(0));

        emit SupplierWallet(ownerAddr, safe);
        return safe;
    }

    /// @dev Create Safe for supplier and return it.
    /// only bridge can call it.
    function registerSupplier(address ownerAddr) external returns (address) {
        require(msg.sender == tokenBridge);
        address safe = _registerSupplier(ownerAddr);
        return safe;
    }
}
