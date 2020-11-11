pragma solidity ^0.5.17;

import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./IRevenuePool.sol";
import "./token/IERC677.sol";
import "./token/ISPEND.sol";
import "./roles/Tally.sol";
import "./roles/PayableToken.sol";

contract RevenuePool is Tally, PayableToken {
    event CreateMerchantWallet(address merchant, address wallet);

    //setup(address[],uint256,address,bytes,address,address,uint256,address)
    bytes4 internal constant SETUP_GNOSIS_SAFE = 0xb63e800d; 

    using SafeMath for uint256;

    address private spendToken;
    address private gsMasterCopy;
    address private gsProxyFactory;

    struct Merchant {
        address wallet;        
        mapping(address => uint256) lockTotal;
    }

    mapping(address => Merchant) merchants;

    /**
     * @dev set up revenue pool
     * @param _tally tally account - have admin permission.
     * @param _gnosisSafe is array, _gnosisSafe[0] is masterCopy address, _gnosisSafe[1] is gnosis proxy factory address.
     * @param _spendToken SPEND token address. 
     * @param _payableTokens are a list of payable token supported by the revenue pool
     */
    function setup(
        address _tally,
        address[] memory _gnosisSafe,
        address _spendToken,
        address[] memory _payableTokens
    ) public onlyOwner {
        // setup tally user
        addTally(_tally);
        // setup gnosis safe address
        gsMasterCopy = _gnosisSafe[0];
        gsProxyFactory = _gnosisSafe[1];

        spendToken = _spendToken;
        // set token list payable.
        for (uint256 i = 0; i < _payableTokens.length; ++i) {
            addPayableToken(_payableTokens[i]);
        }
    }

    /**
     * @dev create merchant wallet(gnosis safe)
     * @param walletOwner - wallet owner 
     * @return address of merchant wallet
     */
    function createWallet(address walletOwner) internal returns (address) {
        address[] memory owners = new address[](1);
        owners[0] = walletOwner;

        // data use for init gnosis safe
        bytes memory dataSetup = abi.encodeWithSelector(
            SETUP_GNOSIS_SAFE,
            owners,
            1,
            address(0),
            hex"",
            address(0),
            address(0),
            0,
            address(0)
        );

        address gnosis = address(
            GnosisSafeProxyFactory(gsProxyFactory).createProxy(
                gsMasterCopy,
                dataSetup
            )
        );

        emit CreateMerchantWallet(walletOwner, gnosis);

        return gnosis;
    }

    /**
     * @dev register merchant, can only by tally account
     * @param merchantId - address of merchant 
     */
    function registerMerchant(address merchantId)
        external
        onlyTally
        returns (bool)
    {
        require(
            merchantId != address(0),
            "Merchant address shouldn't zero address"
        );

        Merchant storage merchant = merchants[merchantId];

        require(merchant.wallet == address(0), "Merchant exists");

        //create wallet for merchant
        merchant.wallet = createWallet(merchantId);

        merchants[merchantId] = merchant;

        return true;
    }

    function getMerchantWallet(address merchantId)
        public
        view
        returns (address)
    {
        return merchants[merchantId].wallet;
    }

    /**
     * @dev query exchange rate of payable token and SPEND 
     * @param _token address of payableToken
     * @return exchange rate
     */
    function exchangeRateOf(address _token) internal pure returns (uint256) {
        // TODO: using current exchange rate from chainlink
        return 100;
    }

    /**
     * @dev convert amount in SPEND to amount in payableToken
     * @param payableTokenAddr address of payableToken 
     * @param amount amount in SPEND
     */
    function convertToPayableToken(address payableTokenAddr, uint256 amount)
        internal
        pure
        returns (uint256)
    {
        return amount.div(exchangeRateOf(payableTokenAddr));
    }

     /**
     * @dev convert amount in payableToken to amount in SPEND
     * @param payableTokenAddr address of payableToken 
     * @param amount amount in payableToken
     * @return amount 
     */
    function convertToSpend(address payableTokenAddr, uint256 amount)
        internal
        pure
        returns (uint256)
    {
        return amount.mul(exchangeRateOf(payableTokenAddr));
    }

    /**
     * @dev mint SPEND for merchant wallet when customer pay token for them.
     * @param merchantId merchant account address 
     * @param payableToken payableToken contract address
     * @param amount amount in payableToken
     */
    function _pay(
        address merchantId,
        address payableToken,
        uint256 amount
    ) internal returns (bool) {
        address merchantWallet = getMerchantWallet(merchantId);
        require(merchantWallet != address(0), "Merchants not registered");

        uint lockTotal = merchants[merchantId].lockTotal[payableToken];
        merchants[merchantId].lockTotal[payableToken] = lockTotal.add(amount);

        uint256 amountSPEND = convertToSpend(payableToken, amount);

        ISPEND(spendToken).mint(merchantWallet, amountSPEND);

        return true;
    }

    /**
     * @dev onTokenTransfer(ERC677) - call when token receive pool. 
     * we will exchange receive token to SPEND token and mint it for the wallet of merchant.
     * @param from - who transfer token (should from prepaid card).
     * @param amount - number token customer pay for merchant.
     * @param data - merchantId in encode format.
     */
    function onTokenTransfer(
        address from,
        uint256 amount,
        bytes calldata data
    ) external onlyPayableToken() returns (bool) {
        address merchantId = abi.decode(data, (address));
        _pay(merchantId, _msgSender(), amount);
        return true;
    }

    /**
     * @dev merchant redeem, only tally account can call this method
     * @param merchantId address of merchant
     * @param payableToken address of payable token
     * @param amountSPEND amount in spend token
     */
    function redeemRevenue(
        address merchantId,
        address payableToken,
        uint256 amountSPEND
    ) external onlyTally verifyPayableToken(payableToken) returns (bool) {
        
        address merchantWallet = getMerchantWallet(merchantId);

        require(merchantWallet != address(0), "Merchants not registered");

        // burn spend in merchant wallet
        ISPEND(spendToken).burn(merchantWallet, amountSPEND);

        // exchange amount SPEND to payable token(DAICPXD or USDTCPXD)
        uint256 amountOther = convertToPayableToken(payableToken, amountSPEND);

        // ensure enough token for redeem
        uint256 lockTotal = merchants[merchantId].lockTotal[payableToken];
        require(amountOther <= lockTotal, "Don't enough token for redeem");

        // unlock token of merchant
        lockTotal = lockTotal.sub(amountOther);

        // update new lockTotal
        merchants[merchantId].lockTotal[payableToken] = lockTotal;

        // transfer payable token from revenue pool to merchant wallet address
        IERC677(payableToken).transfer(merchantWallet, amountOther);
        
        return true;
    }
}
