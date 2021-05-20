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

contract RevenuePool is
  Versionable,
  Initializable,
  TallyRole,
  MerchantManager,
  Exchange
{
  using SafeMath for uint256;

  address public spendToken;
  address public merchantFeeReceiver;
  uint256 public merchantFeePercentage;

  event Setup();
  event MerchantClaim(
    address merchantSafe,
    address payableToken,
    uint256 amount
  );

  event CustomerPayment(
    address card,
    address merchantSafe,
    address payableToken,
    uint256 amount
  );

  event MerchantFeeCollected(
    address merchantSafe,
    address card,
    address issuingToken,
    uint256 amount
  );

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
    address[] calldata _payableTokens,
    address _merchantFeeReceiver,
    uint256 _merchantFeePercentage
  ) external onlyOwner {
    // setup tally user
    if (_tally != address(0)) {
      _addTally(_tally);
    }
    // setup gnosis safe address
    MerchantManager.setup(_gsMasterCopy, _gsProxyFactory);

    spendToken = _spendToken;
    merchantFeeReceiver = _merchantFeeReceiver;
    merchantFeePercentage = _merchantFeePercentage;
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
    // a quirk about exponents is that the result will be calculated in the type
    // of the base, so in order to prevent overflows you should use a base of
    // uint256
    uint256 ten = 10;
    uint256 merchantFee =
      merchantFeeReceiver != address(0) && merchantFeePercentage > 0
        ? (amount.mul(merchantFeePercentage)).div(ten**merchantFeeDecimals())
        : 0;

    uint256 merchantProceeds = amount.sub(merchantFee);
    address issuingToken = _msgSender();
    handlePayment(merchantSafe, issuingToken, merchantProceeds);

    if (merchantFeeReceiver != address(0)) {
      // The merchantFeeReceiver is a trusted address
      IERC677(issuingToken).transfer(merchantFeeReceiver, merchantFee);
      emit MerchantFeeCollected(merchantSafe, from, issuingToken, merchantFee);
    }

    emit CustomerPayment(from, merchantSafe, issuingToken, amount);
    return true;
  }

  /**
   * @dev merchant claims revenue with their safe
   * @param payableToken address of payable token
   * @param amount amount in payable token
   */
  function claimRevenue(address payableToken, uint256 amount)
    external
    onlyMerchantSafe
    returns (bool)
  {
    return _claimRevenue(msg.sender, payableToken, amount);
  }

  function revenueTokens(address merchantSafe)
    external
    view
    returns (address[] memory)
  {
    return merchantSafes[merchantSafe].tokens.enumerate();
  }

  function revenueBalance(address merchantSafe, address payableToken)
    external
    view
    returns (uint256)
  {
    return merchantSafes[merchantSafe].balance[payableToken];
  }

  function merchantFeeDecimals() public pure returns (uint8) {
    return 8;
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

    uint256 balance = merchantSafes[merchantSafe].balance[payableToken];
    merchantSafes[merchantSafe].balance[payableToken] = balance.add(amount);
    merchantSafes[merchantSafe].tokens.add(payableToken);

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
  function _claimRevenue(
    address merchantSafe,
    address payableToken,
    uint256 amount
  ) internal isValidTokenAddress(payableToken) returns (bool) {
    // ensure enough token for redeem
    uint256 balance = merchantSafes[merchantSafe].balance[payableToken];
    require(amount <= balance, "Insufficient funds");

    // unlock token of merchant
    balance = balance.sub(amount);

    // update new balance
    merchantSafes[merchantSafe].balance[payableToken] = balance;

    // transfer payable token from revenue pool to merchant's safe address. The
    // merchant's safe address is a gnosis safe contract, created by
    // registerMerchant(), so this is a trusted contract transfer
    IERC677(payableToken).transfer(merchantSafe, amount);

    emit MerchantClaim(merchantSafe, payableToken, amount);
    return true;
  }
}
