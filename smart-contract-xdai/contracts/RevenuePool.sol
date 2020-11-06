pragma solidity ^0.5.0;

import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";

import "./IRevenuePool.sol";
import "./token/IERC677.sol";
import "./token/ISPEND.sol";

contract RevenuePool is Ownable {    
    event WalletAddress(address merchant, address wallet);

    address private GSmasterCopyAddress;
    ISPEND private spendToken;
    IERC677 private daiCPXDToken;
    GnosisSafeProxyFactory private GSproxyFactory;


    struct Merchant {
        address wallet;
        string name;
    }

    mapping (address => Merchant) merchants;

    function setup(address _spendAddress, address _daiCPXDAddress, address _GSproxyFactoryAddress, address _GSmasterCopyAddress) 
        public 
        onlyOwner
    {   
        GSmasterCopyAddress = _GSmasterCopyAddress;
        GSproxyFactory = GnosisSafeProxyFactory(_GSproxyFactoryAddress);
        daiCPXDToken = IERC677(_daiCPXDAddress);
        spendToken = ISPEND(_spendAddress);
    }

    
    function createWallet(address walletOwner) internal returns(address) {
        address[] memory owners = new address[](1); 
        owners[0] = address(walletOwner);
        bytes memory payloads = abi.encodeWithSignature("setup(address[],uint256,address,bytes,address,address,uint256,address)", 
                                owners, 1, address(0), hex"", address(0), address(0), 0, address(0));
        
        address walletProxy = address(GSproxyFactory.createProxy(GSmasterCopyAddress, payloads));
        emit WalletAddress(walletOwner, walletProxy);

        return walletProxy;
    }


    function registerMerchant(address merchantId, string calldata name) 
        external 
        onlyOwner 
        returns(bool) 
    {
        require(merchantId != address(0), "Merchant address shouldn't zero address.");

        Merchant storage merchant = merchants[merchantId];

        require(merchant.wallet == address(0), "Merchant has been resiter");

        // create new merchant
        merchant.name = name;
        merchant.wallet = createWallet(merchantId);
        merchants[merchantId] = merchant;    

        return true;
    }

    function getWalletAddress(address merchantId) public view returns(address) {
        return merchants[merchantId].wallet;
    }

    function rate() internal pure returns(uint) {
        // TODO: using current exchange rate from chainlink
        return 100;
    }

    function exchangeSPENDToDAI(uint spend) internal pure returns(uint) {
        // TODO: use safe math
        return spend / rate();
    }
    function exchangeDAIToSPEND(uint dai) internal pure returns(uint) {
        // TODO: use safe math
        return dai * rate();
    }

 
    function _pay(address merchantId, uint amount) internal returns(bool) {

        address wallet = merchants[merchantId].wallet;
        require(wallet != address(0), "You should register merchant role first.");

        uint spendAmount = exchangeDAIToSPEND(amount);
        spendToken.mint(wallet, spendAmount);

        return true;
    }

    function tokenFallback(address from, uint amount, bytes calldata data) external returns(bool) {
        // TODO: find better way describe data
        // TODO: verify from address is prepaid 
        // only DAICPXD contract can call this method
        require(msg.sender == address(daiCPXDToken), "Something wrong!!!");
        (address merchantId) = abi.decode(data, (address));
        _pay(merchantId, amount);
        return true;
    }

    /**
     * @dev merchant redeem
     * @param merchantId address of merchant
     * @param amountInSPEND amount in spend token
     * TODO: set who can call this method
     */
    function redeemRevenue(address merchantId, uint amountInSPEND) external returns(bool) {

        address merchantWalletAddress = getWalletAddress(merchantId);
        require(merchantWalletAddress != address(0), "Merchant has been not register");

        // burn spend in merchant wallet
        spendToken.burn(merchantWalletAddress, amountInSPEND);  

        // exchange amount SPEND to DAI
        uint amountInDAI = exchangeSPENDToDAI(amountInSPEND);

        // transfer from DAI to merchant wallet address
        daiCPXDToken.transfer(merchantWalletAddress, amountInDAI);

        return true;
    }

}