pragma solidity 0.5.17;

import "./core/Safe.sol";
import "./roles/PayableToken.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";


contract BridgeUtils is Safe, Ownable {
    event SupplierWallet(address owner, address wallet);
    event UpdateToken(address token);

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

    // TODO: what do we intend to do with the tally address? currently it is unsused
    constructor(address _tallyAdmin) public {
        tallyAdmin = _tallyAdmin;
    }

    modifier onlyBridgeMediator() {
        require(
            msg.sender == bridgeMediator,
            "Guard: Action supported only by the bridge mediator"
        );
        _;
    }

    function isRegistered(address supplierAddr) public view returns (bool) {
        return suppliers[supplierAddr].registered;
    }

    function setup(
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

    function updateSupplier(
        string calldata brandName,
        string calldata brandProfileUrl
    ) external returns (bool) {
        address supplierAddr = msg.sender;

        // perhaps we want to allow the owner of the contract to be able to set
        // this as well just in case?
        require(suppliers[supplierAddr].registered, "Supplier is invalid.");

        suppliers[supplierAddr].brandName = brandName;
        suppliers[supplierAddr].brandProfileUrl = brandProfileUrl;

        return true;
    }

    function registerSupplier(address ownerAddr)
        external
        onlyBridgeMediator
        returns (address)
    {
        return _registerSupplier(ownerAddr);
    }

    function _updateToken(address tokenAddr) internal returns (bool) {
        // update payable token for token
        PayableToken(revenuePool).addPayableToken(tokenAddr);
        PayableToken(prepaidCardManager).addPayableToken(tokenAddr);
        emit UpdateToken(tokenAddr);
        return true;
    }

    function updateToken(address tokenAddr)
        external
        onlyBridgeMediator
        returns (bool)
    {
        return _updateToken(tokenAddr);
    }

    function _registerSupplier(address ownerAddr) internal returns (address) {
        address safe = createSafe(ownerAddr);
        suppliers[safe].registered = true;

        emit SupplierWallet(ownerAddr, safe);
        return safe;
    }
}
