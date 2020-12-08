pragma solidity ^0.5.17;

import "@openzeppelin/contracts/utils/EnumerableSet.sol";

import "./Safe.sol";
import "../roles/TallyRole.sol";

contract MerchantManager is TallyRole, Safe {
    using EnumerableSet for EnumerableSet.AddressSet;

    event CreateMerchantWallet(address merchant, address wallet);

    struct Merchant {
        EnumerableSet.AddressSet wallets;
        string merchantId; // offchant id
        bool registered;
        mapping(address => uint256) lockTotal;
    }

    mapping(address => Merchant) internal merchants;

    function setup(address _gsMasterCopy, address _gsProxyFactory) internal {
        Safe.setup(_gsMasterCopy, _gsProxyFactory);
    }

    function isRegistered(address account) public view returns (bool) {
        return merchants[account].registered;
    }

    function registerMerchant(address merchantAddr, string calldata merchantId)
        external
        onlyTally
    {
        require(
            merchantAddr != address(0),
            "Merchant address shouldn't zero address"
        );

        require(!isRegistered(merchantAddr), "Merchants registered");

        merchants[merchantAddr].registered = true;

        merchants[merchantAddr].merchantId = merchantId;

        createAndAddWallet(merchantAddr);

    }

    function createAndAddWallet(address merchantAddr) public onlyTally returns(bool) {
        require(isRegistered(merchantAddr), "Merchants not registered");
        
        
        address gsWalletAddr = createSafe(merchantAddr);
        
        merchants[merchantAddr].wallets.add(gsWalletAddr);

        emit CreateMerchantWallet(merchantAddr, gsWalletAddr);
        return true;
    }

    function getNumberWallet(address merchantAddr) public view returns(uint) {
        return merchants[merchantAddr].wallets.values.length;
    }
    
    function getMerchantWallet(address merchantAddr, uint256 walletIndex)
        public
        view
        returns (address)
    {
        require(isRegistered(merchantAddr), "Merchants not registered");
        require(walletIndex < getNumberWallet(merchantAddr), "Wrong wallet index");

        return merchants[merchantAddr].wallets.get(walletIndex);
    }
}
