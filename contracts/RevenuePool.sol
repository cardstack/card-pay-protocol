pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

import "./token/IERC677.sol";
import "./token/ISPEND.sol";
import "./core/MerchantManager.sol";
import "./core/Exchange.sol";
import "./core/Versionable.sol";
import "./PrepaidCardManager.sol";
import "./BridgeUtils.sol";

contract RevenuePool is Versionable, Initializable, MerchantManager, Exchange {
  using SafeMath for uint256;

  address public spendToken;
  address payable public merchantFeeReceiver;
  uint256 public merchantFeePercentage;
  uint256 public merchantRegistrationFeeInSPEND;
  address payable public prepaidCardManager;

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
   * @param _prepaidCardManager the address of the PrepaidCardManager contract
   * @param _gsMasterCopy is masterCopy address
   * @param _gsProxyFactory is gnosis proxy factory address.
   * @param _spendToken SPEND token address.
   * @param _payableTokens are a list of payable token supported by the revenue
     pool
   * @param _merchantFeeReceiver the address that receives the merchant fees
   * @param _merchantFeePercentage the numerator of a decimals 8 fraction that
     represents the merchant fee percentage that is charged for each merchant
     payment
   * @param _merchantRegistrationFeeInSPEND the amount in SPEND that is charged for a merchant to register
   */
  function setup(
    address payable _prepaidCardManager,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address _spendToken,
    address[] calldata _payableTokens,
    address payable _merchantFeeReceiver,
    uint256 _merchantFeePercentage,
    uint256 _merchantRegistrationFeeInSPEND
  ) external onlyOwner {
    require(_merchantFeeReceiver != address(0), "merchantFeeReciever not set");
    require(
      _merchantRegistrationFeeInSPEND > 0,
      "merchantRegistrationFeeInSPEND is not set"
    );
    // setup gnosis safe address
    MerchantManager.setup(_gsMasterCopy, _gsProxyFactory);

    prepaidCardManager = _prepaidCardManager;
    spendToken = _spendToken;
    merchantFeeReceiver = _merchantFeeReceiver;
    merchantFeePercentage = _merchantFeePercentage;
    merchantRegistrationFeeInSPEND = _merchantRegistrationFeeInSPEND;
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
    address payable from,
    uint256 amount,
    bytes calldata data
  ) external isValidToken returns (bool) {
    require(merchantFeeReceiver != address(0), "merchantFeeReciever not set");
    // The Revenue pool can only receive funds from prepaid cards
    PrepaidCardManager prepaidCardMgr = PrepaidCardManager(prepaidCardManager);
    (, address issuer, ) = prepaidCardMgr.cardDetails(from);
    require(issuer != address(0), "Caller is not a prepaid card");

    // decode and get merchant address from the data
    address merchantSafe = abi.decode(data, (address));
    address issuingToken = _msgSender();

    if (merchantSafe == address(0)) {
      // Merchant registration
      return handleMerchantRegister(from, issuingToken, amount);
    } else {
      // Merchant payment
      uint256 ten = 10;
      uint256 merchantFee =
        merchantSafe != address(0) && merchantFeePercentage > 0
          ? (amount.mul(merchantFeePercentage)).div(ten**merchantFeeDecimals())
          : 0;
      uint256 merchantProceeds = amount.sub(merchantFee);
      handlePayment(merchantSafe, issuingToken, merchantProceeds);
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

  function handleMerchantRegister(
    address payable prepaidCard,
    address issuingToken,
    uint256 amount
  ) internal returns (bool) {
    uint256 merchantRegistrationFeeInToken =
      convertFromSpend(issuingToken, merchantRegistrationFeeInSPEND);
    require(
      amount >= merchantRegistrationFeeInToken,
      "Insufficient funds for merchant registration"
    );
    // The merchantFeeReceiver is a trusted address
    IERC677(issuingToken).transfer(
      merchantFeeReceiver,
      merchantRegistrationFeeInToken
    );
    uint256 refund = amount.sub(merchantRegistrationFeeInToken);
    if (refund > 0) {
      // from is a trusted contract address (gnosis safe)
      IERC677(issuingToken).transfer(prepaidCard, refund);
    }

    address[] memory owners = GnosisSafe(prepaidCard).getOwners();
    require(owners.length == 2, "unexpected number of owners for prepaid card");
    address merchantOrDepot =
      owners[0] == prepaidCardManager ? owners[1] : owners[0];

    // check for the scenario where the merchant issued their own prepaid card,
    // in which case the owner here is actually a depot safe where the real
    // merchant address is the owner of the depot safe.
    if (BridgeUtils(bridgeUtils).safes(merchantOrDepot) == address(0)) {
      registerMerchant(merchantOrDepot);
      return true;
    }

    address payable depot = address(uint160(merchantOrDepot));
    address[] memory depotOwners = GnosisSafe(depot).getOwners();
    require(owners.length == 1, "unexpected number of owners for depot");
    registerMerchant(depotOwners[0]);
    return true;
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
