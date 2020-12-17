pragma solidity 0.5.17;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./IRevenuePool.sol";
import "./token/IERC677.sol";
import "./token/ISPEND.sol";
import "./roles/TallyRole.sol";
import "./core/MerchantManager.sol";
import "./core/Exchange.sol";

contract RevenuePool is
    TallyRole,
    MerchantManager,
    Exchange
{
    using SafeMath for uint256;

    event Redeem(
        address merchantAddr,
        uint256 walletIndex,
        address payableToken,
        uint256 amount
    );
    event Payment(
        address prepaidCardArr,
        address merchantAddr,
        uint256 walletIndex,
        address payableToken,
        uint256 amount
    );

    address private spendToken;

    /**
     * @dev set up revenue pool
     * @param _tally tally account - have admin permission.
     * @param _gsMasterCopy is masterCopy address
     * @param _gsProxyFactory is gnosis proxy factory address.
     * @param _spendToken SPEND token address.
     * @param _payableTokens are a list of payable token supported by the revenue pool
     */
    function setup(
        address _tally,
        address _gsMasterCopy,
        address _gsProxyFactory,
        address _spendToken,
        address[] memory _payableTokens
    ) public onlyOwner {
        // setup tally user
        addTally(_tally);
        // setup gnosis safe address
        MerchantManager.setup(_gsMasterCopy, _gsProxyFactory);

        spendToken = _spendToken;
        // set token list payable.
        for (uint256 i = 0; i < _payableTokens.length; i++) {
            addPayableToken(_payableTokens[i]);
        }
    }

    /**
     * @dev mint SPEND for merchant wallet when customer pay token for them.
     * @param merchantAddr merchant account address
     * @param walletIndex wallet index of merchant
     * @param payableToken payableToken contract address
     * @param amount amount in payableToken
     */
    function _pay(
        address merchantAddr,
        uint256 walletIndex,
        address payableToken,
        uint256 amount
    ) internal returns (bool) {
        address merchantWallet = getMerchantWallet(merchantAddr, walletIndex);

        uint256 lockTotal = merchants[merchantAddr].lockTotal[payableToken];
        merchants[merchantAddr].lockTotal[payableToken] = lockTotal.add(amount);

        uint256 amountSPEND = convertToSpend(payableToken, amount);

        ISPEND(spendToken).mint(merchantWallet, amountSPEND);

        return true;
    }

    /**
     * @dev onTokenTransfer(ERC677) - call when token receive pool.
     * we will exchange receive token to SPEND token and mint it for the wallet of merchant.
     * @param from - who transfer token (should from prepaid card).
     * @param amount - number token customer pay for merchant.
     * @param data - merchantAddr in encode format.
     */
    function onTokenTransfer(
        address from,
        uint256 amount,
        bytes calldata data
    ) external onlyPayableToken() returns (bool) {

        (address merchantAddr, uint256 walletIndex) = abi.decode(
            data,
            (address, uint256)
        );

        _pay(merchantAddr, walletIndex, _msgSender(), amount);

        emit Payment(from, merchantAddr, walletIndex, _msgSender(), amount);
        return true;
    }

    /**
     * @dev merchant redeem
     * @param merchantAddr address of merchant
     * @param walletIndex wallet index of merchant
     * @param payableToken address of payable token
     * @param amount amount in payable token
     */
    function _redeemRevenue(
        address merchantAddr,
        uint256 walletIndex,
        address payableToken,
        uint256 amount
    ) internal verifyPayableToken(payableToken) returns (bool) {
        // get merchant wallet by merchant Address and wallet index
        address merchantWallet = getMerchantWallet(merchantAddr, walletIndex);

        // ensure enough token for redeem
        uint256 lockTotal = merchants[merchantAddr].lockTotal[payableToken];
        require(amount <= lockTotal, "Don't enough token for redeem");

        // unlock token of merchant
        lockTotal = lockTotal.sub(amount);

        // update new lockTotal
        merchants[merchantAddr].lockTotal[payableToken] = lockTotal;

        // transfer payable token from revenue pool to merchant wallet address
        IERC677(payableToken).transfer(merchantWallet, amount);

        emit Redeem(merchantAddr, walletIndex, payableToken, amount);
        return true;
    }

     /**
     * @dev merchant redeem, only tally account can call this method
     * @param merchantAddr address of merchant
     * @param walletIndex wallet index of merchant
     * @param payableTokens array address of payable token
     * @param amounts array amount in payable token
     */
    function redeemRevenue(
        address merchantAddr,
        uint256 walletIndex,
        address[] calldata payableTokens,
        uint256[] calldata amounts
    ) external onlyTally returns (bool) {
        uint256 numberKindOfToken = payableTokens.length;

        require(numberKindOfToken == amounts.length);

        for (uint256 index = 0; index < numberKindOfToken; index = index + 1) {
            _redeemRevenue(
                merchantAddr,
                walletIndex,
                payableTokens[index],
                amounts[index]
            );
        }

        return true;
    }
}