pragma solidity 0.5.17;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./token/IERC677.sol";
import "./token/ISPEND.sol";
import "./roles/TallyRole.sol";
import "./core/MerchantManager.sol";
import "./core/Exchange.sol";
import "./interfaces/IRevenuePool.sol";

contract RevenuePool is
    TallyRole,
    MerchantManager,
    Exchange, 
    IRevenuePool
{
    using SafeMath for uint256;

    event Claim(
        address merchantAddr,
        address payableToken,
        uint256 amount
    );
    event Payment(
        address prepaidCardArr,
        address merchantAddr,
        address payableToken,
        uint256 amount
    );

    address public spendToken;

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
     * @param payableToken payableToken contract address
     * @param amount amount in payableToken
     */
    function handlePayment(
        address merchantAddr,
        address payableToken,
        uint256 amount
    ) internal returns (bool) {
        require(isMerchant(merchantAddr), "merchant not exist");
        uint256 lockTotal = merchants[merchantAddr].lockTotal[payableToken];
        merchants[merchantAddr].lockTotal[payableToken] = lockTotal.add(amount);

        uint256 amountSPEND = convertToSpend(payableToken, amount);

        ISPEND(spendToken).mint(merchantAddr, amountSPEND);

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

        // decode and get merchant address from the data
        (address merchantAddr) = abi.decode(data, (address));

        handlePayment(merchantAddr, _msgSender(), amount);

        emit Payment(from, merchantAddr, _msgSender(), amount);
        return true;
    }

    /**
     * @dev merchant claim token
     * @param merchantAddr address of merchant
     * @param payableToken address of payable token
     * @param amount amount in payable token
     */
    function _claimToken(
        address merchantAddr,
        address payableToken,
        uint256 amount
    ) internal onlyPayableTokens(payableToken) returns (bool) {

        // ensure enough token for redeem
        uint256 lockTotal = merchants[merchantAddr].lockTotal[payableToken];
        require(amount <= lockTotal, "Don't enough token for redeem");

        // unlock token of merchant
        lockTotal = lockTotal.sub(amount);

        // update new lockTotal
        merchants[merchantAddr].lockTotal[payableToken] = lockTotal;

        // transfer payable token from revenue pool to merchant wallet address
        IERC677(payableToken).transfer(merchantAddr, amount);

        emit Claim(merchantAddr, payableToken, amount);
        return true;
    }

     /**
     * @dev merchant claim token to their wallets, only tally account can call this method
     * @param merchantAddr address of merchant
     * @param payableTokens array address of payable token
     * @param amounts array amount in payable token
     */
    function claimTokens(
        address merchantAddr,
        address[] calldata payableTokens,
        uint256[] calldata amounts
    ) external onlyTally returns (bool) {
        uint256 totalType = payableTokens.length;

        require(totalType == amounts.length);

        for (uint256 index = 0; index < totalType; index = index + 1) {
            _claimToken(
                merchantAddr,
                payableTokens[index],
                amounts[index]
            );
        }

        return true;
    }
}
