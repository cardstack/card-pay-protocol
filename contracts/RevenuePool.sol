pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";

import "./token/IERC677.sol";
import "./token/ISPEND.sol";
import "./roles/TallyRole.sol";
import "./core/MerchantManager.sol";
import "./core/Exchange.sol";
import "./interfaces/IRevenuePool.sol";


contract RevenuePool is Initializable, TallyRole, MerchantManager, Exchange, IRevenuePool {
    using SafeMath for uint256;

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
    ) external isValidToken returns (bool) {
        // decode and get merchant address from the data
        address merchantAddr = abi.decode(data, (address));

        handlePayment(merchantAddr, _msgSender(), amount);

        emit CustomerPayment(from, merchantAddr, _msgSender(), amount);
        return true;
    }

    /**
     * @dev merchant claim token to their wallet, only tally account can call this method
     * @param merchantAddr address of merchant
     * @param payableToken address of payable token
     * @param amount amount in payable token
     */
    function claimToken(
        address merchantAddr,
        address payableToken,
        uint256 amount
    ) external onlyTally returns (bool) {
        return _claimToken(merchantAddr, payableToken, amount);
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
        require(isMerchant(merchantAddr), "Invalid merchant");

        uint256 lockTotal = merchants[merchantAddr].lockTotal[payableToken];
        merchants[merchantAddr].lockTotal[payableToken] = lockTotal.add(amount);

        uint256 amountSPEND = convertToSpend(payableToken, amount);

        ISPEND(spendToken).mint(merchantAddr, amountSPEND);

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
    ) internal isValidTokenAddress(payableToken) returns (bool) {
        // ensure enough token for redeem
        uint256 lockTotal = merchants[merchantAddr].lockTotal[payableToken];
        require(amount <= lockTotal, "Insufficient funds");

        // unlock token of merchant
        lockTotal = lockTotal.sub(amount);

        // update new lockTotal
        merchants[merchantAddr].lockTotal[payableToken] = lockTotal;

        // transfer payable token from revenue pool to merchant address. The
        // merchant address is actually a gnosis safe contract, created by
        // registerMerchant(), so this is a trusted contract transfer
        IERC677(payableToken).transfer(merchantAddr, amount);

        emit MerchantClaim(merchantAddr, payableToken, amount);
        return true;
    }
}
