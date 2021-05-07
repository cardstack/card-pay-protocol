pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";

import "./token/IERC677.sol";
import "./token/ISPEND.sol";
import "./roles/TallyRole.sol";
import "./core/MerchantManager.sol";
import "./core/Exchange.sol";
import "./core/Versionable.sol";
import "./interfaces/IRevenuePool.sol";

contract RevenuePool is
  Versionable,
  Initializable,
  TallyRole,
  MerchantManager,
  Exchange,
  IRevenuePool
{
  using SafeMath for uint256;

  address public spendToken;
  event Setup();

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
    address[] calldata _payableTokens
  ) external onlyOwner {
    // setup tally user
    if (_tally != address(0)) {
      _addTally(_tally);
    }
    // setup gnosis safe address
    MerchantManager.setup(_gsMasterCopy, _gsProxyFactory);

    spendToken = _spendToken;
    // set token list payable.
    for (uint256 i = 0; i < _payableTokens.length; i++) {
      _addPayableToken(_payableTokens[i]);
    }
    emit Setup();
  }

  /**
   * @dev onTokenTransfer(ERC677) - call when token receive pool.
   * we will exchange receive token to SPEND token and mint it for the wallet of merchant.
   * @param from - who transfer token (should from prepaid card).
   * @param amount - number token customer pay for merchant.
   * @param data - merchant safe in encode format.
   */
  function onTokenTransfer(
    address from,
    uint256 amount,
    bytes calldata data
  ) external isValidToken returns (bool) {
    // decode and get merchant address from the data
    address merchantSafe = abi.decode(data, (address));

    handlePayment(merchantSafe, _msgSender(), amount);

    emit CustomerPayment(from, merchantSafe, _msgSender(), amount);
    return true;
  }

  /**
   * @dev merchant claim token to their wallet, only tally account can call this method
   * @param merchantSafe address of merchantSafe
   * @param payableToken address of payable token
   * @param amount amount in payable token
   */
  function claimToken(
    address merchantSafe,
    address payableToken,
    uint256 amount
  ) external onlyTallyOrOwner returns (bool) {
    return _claimToken(merchantSafe, payableToken, amount);
  }

  /**
   * @dev mint SPEND for merchant wallet when customer pay token for them.
   * @param merchantSafe merchant safe address
   * @param payableToken payableToken contract address
   * @param amount amount in payableToken
   */
  function handlePayment(
    address merchantSafe,
    address payableToken,
    uint256 amount
  ) internal returns (bool) {
    require(isMerchantSafe(merchantSafe), "Invalid merchant");

    uint256 lockTotal = merchantSafes[merchantSafe].lockTotal[payableToken];
    merchantSafes[merchantSafe].lockTotal[payableToken] = lockTotal.add(amount);

    uint256 amountSPEND = convertToSpend(payableToken, amount);

    ISPEND(spendToken).mint(merchantSafe, amountSPEND);

    return true;
  }

  /**
   * @dev merchant claim token
   * @param merchantSafe address of merchant
   * @param payableToken address of payable token
   * @param amount amount in payable token
   */
  function _claimToken(
    address merchantSafe,
    address payableToken,
    uint256 amount
  ) internal isValidTokenAddress(payableToken) returns (bool) {
    // ensure enough token for redeem
    uint256 lockTotal = merchantSafes[merchantSafe].lockTotal[payableToken];
    require(amount <= lockTotal, "Insufficient funds");

    // unlock token of merchant
    lockTotal = lockTotal.sub(amount);

    // update new lockTotal
    merchantSafes[merchantSafe].lockTotal[payableToken] = lockTotal;

    // transfer payable token from revenue pool to merchant's safe address. The
    // merchant's safe address is a gnosis safe contract, created by
    // registerMerchant(), so this is a trusted contract transfer
    IERC677(payableToken).transfer(merchantSafe, amount);

    emit MerchantClaim(merchantSafe, payableToken, amount);
    return true;
  }
}
