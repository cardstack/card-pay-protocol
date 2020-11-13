pragma solidity ^0.5.17;

import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";

import "../roles/TallyRole.sol";

contract MerchantManager is TallyRole {
    using EnumerableSet for EnumerableSet.AddressSet;

    event CreateMerchantWallet(address merchant, address wallet);

    //setup(address[],uint256,address,bytes,address,address,uint256,address)
    bytes4 internal constant SETUP_GNOSIS_SAFE = 0xb63e800d;

    address internal gsMasterCopy;
    address internal gsProxyFactory;

    struct Merchant {
        EnumerableSet.AddressSet wallets;
        string merchantId; // offchant id
        bool registered;
        mapping(address => uint256) lockTotal;
    }

    mapping(address => Merchant) internal merchants;

    function setup(address _gsMasterCopy, address _gsProxyFactory) internal {
        gsMasterCopy = _gsMasterCopy;
        gsProxyFactory = _gsProxyFactory;
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

    function createGnosisSafeWallet(address walletOwner)
        internal
        returns (address)
    {
        address[] memory walletOwnerArr = new address[](1);
        walletOwnerArr[0] = walletOwner;

        bytes memory data = abi.encodeWithSelector(
            SETUP_GNOSIS_SAFE,
            walletOwnerArr,
            1,
            address(0),
            "",
            address(0),
            address(0),
            0,
            address(0)
        );

        address gsWallet = address(
            GnosisSafeProxyFactory(gsProxyFactory).createProxy(
                gsMasterCopy,
                data
            )
        );

        return gsWallet;
    }

    function createAndAddWallet(address merchantAddr) public onlyTally returns(bool) {
        require(isRegistered(merchantAddr), "Merchants not registered");

        address gsWalletAddr = createGnosisSafeWallet(merchantAddr);
        
        merchants[merchantAddr].wallets.add(gsWalletAddr);
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
