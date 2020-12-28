pragma solidity 0.5.17;

import "./core/Safe.sol";
import "./roles/PayableToken.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";

contract BridgeUtils is Safe, Ownable{
    event SupplierWallet(address onwer, address wallet);

    struct Supplier {
        bool registered;
        string brandName;
        string brandProfileUrl;
    }

    mapping(address => Supplier) public suppliers;

    address public tallyAdmin;
    address public revenuePool;
    address public prepaidCardManager;
    address public bridgeMediator;

    constructor(address _tallyAdmin) public {
        tallyAdmin = _tallyAdmin;
    }

    modifier onlyBridgeMediator() {
        require(
            msg.sender == bridgeMediator,
            "Guard: Action support only bridge mediator"
        );
        _;
    }

    function isRegistered(address supplierAddr) public view returns (bool) {
        return suppliers[supplierAddr].registered;
    }

    /// TODO: need permission for do this action
    /// @dev only tallyAdmin can call it.
    function setUp(
        address _revenuePool,
        address _prepaidCardManager,
        address _gsMasterCopy,
        address _gsProxyFactory,
        address _bridgeMediator
    ) public onlyOwner returns (bool) {
        
        Safe.setup(_gsMasterCopy, _gsProxyFactory);
        revenuePool = _revenuePool;
        prepaidCardManager = _prepaidCardManager;
        bridgeMediator = _bridgeMediator;

        return true;
    }

    function _updateToken(address tokenAddr) internal returns (bool) {
        // update payable token for token
        PayableToken(revenuePool).addPayableToken(tokenAddr);
        PayableToken(prepaidCardManager).addPayableToken(tokenAddr);

        return true;
    }

    /// @dev only `bridge` can call this method.
    function updateToken(address tokenAddr)
        external
        onlyBridgeMediator
        returns (bool)
    {
        return _updateToken(tokenAddr);
    }

    /// @dev update suppliers information
    function updateSupplier(
        string calldata brandName,
        string calldata brandProfileUrl
    ) external returns (bool) {
        address supplierAddr = msg.sender;

        require(suppliers[supplierAddr].registered, "suppliers is invalid.");

        suppliers[supplierAddr].brandName = brandName;
        suppliers[supplierAddr].brandProfileUrl = brandProfileUrl;

        return true;
    }

    function _registerSupplier(address ownerAddr) internal returns (address) {
        address safe = createSafe(ownerAddr);
        suppliers[safe].registered = true;

        emit SupplierWallet(ownerAddr, safe);
        return safe;
    }

    /// @dev Create Safe for suppliers and return it.
    /// only bridge can call it.
    function registerSupplier(address ownerAddr)
        external
        onlyBridgeMediator
        returns (address)
    {   
        return _registerSupplier(ownerAddr);
    }
}
