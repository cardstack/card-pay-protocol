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

  struct Action {
    string name;
    address payable prepaidCard;
    address issuingToken;
    uint256 tokenAmount;
    uint256 spendAmount;
    uint256 requestedRate;
    bytes32 nameHash;
    bytes data;
  }

  address public spendToken;
  address payable public merchantFeeReceiver;
  uint256 public merchantFeePercentage; // decimals 8
  uint256 public merchantRegistrationFeeInSPEND;
  address payable public prepaidCardManager;
  uint256 public rateDriftPercentage; // decimals 8

  event Setup();
  event MerchantClaim(
    address merchantSafe,
    address payableToken,
    uint256 amount
  );

  event CustomerPayment(
    address card,
    address merchantSafe,
    address issuingToken,
    uint256 issuingTokenAmount,
    uint256 spendAmount
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
   * pool
   * @param _merchantFeeReceiver the address that receives the merchant fees
   * @param _merchantFeePercentage the numerator of a decimals 8 fraction that
   * represents the merchant fee percentage that is charged for each merchant
   * payment
   * @param _merchantRegistrationFeeInSPEND the amount in SPEND that is charged
   * for a merchant to register
   * @param _rateDriftPercentage the numberator of a decimals 8 fraction that
   * represents the percentage of how much a requested rate lock is allowed to
   * drift from the actual rate
   */
  function setup(
    address payable _prepaidCardManager,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address _spendToken,
    address[] calldata _payableTokens,
    address payable _merchantFeeReceiver,
    uint256 _merchantFeePercentage,
    uint256 _merchantRegistrationFeeInSPEND,
    uint256 _rateDriftPercentage
  ) external onlyOwner {
    require(_merchantFeeReceiver != address(0), "merchantFeeReceiver not set");
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
    rateDriftPercentage = _rateDriftPercentage;
    // set token list payable.
    for (uint256 i = 0; i < _payableTokens.length; i++) {
      _addPayableToken(_payableTokens[i]);
    }
    emit Setup();
  }

  /**
   * @dev onTokenTransfer(ERC677) - this is the ERC677 token transfer callback.
   * This will interrogate and perform the requested action from the prepaid
   * card using the token amount sent.
   * @param from - who transfer token (should from prepaid card).
   * @param amount - number token customer pay for merchant.
   * @param data - merchant safe and infoDID in encode format.
   */
  function onTokenTransfer(
    address payable from,
    uint256 amount,
    bytes calldata data
  ) external isValidToken returns (bool) {
    require(merchantFeeReceiver != address(0), "merchantFeeReciever not set");
    // The Revenue pool can only receive funds from prepaid cards
    PrepaidCardManager prepaidCardMgr = PrepaidCardManager(prepaidCardManager);
    (address issuer, , , , , ) = prepaidCardMgr.cardDetails(from);
    require(issuer != address(0), "Caller is not a prepaid card");

    (
      uint256 spendAmount,
      uint256 requestedRate,
      string memory actionName,
      bytes memory actionData
    ) = abi.decode(data, (uint256, uint256, string, bytes));
    Action memory action =
      makeAction(
        actionName,
        from,
        _msgSender(),
        amount,
        spendAmount,
        requestedRate,
        actionData
      );

    return dispatchAction(action);
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

  /**
   * @dev get the list of tokens that a merchant has collected revenue in
   * @param merchantSafe the safe of the merchant to query
   */
  function revenueTokens(address merchantSafe)
    external
    view
    returns (address[] memory)
  {
    return merchantSafes[merchantSafe].tokens.enumerate();
  }

  /**
   * @dev get the unclaimed revenue for a merchant in a specific token
   * @param merchantSafe the safe of the merchant to query
   * @param token the particular token to check for revenue against
   */
  function revenueBalance(address merchantSafe, address token)
    external
    view
    returns (uint256)
  {
    return merchantSafes[merchantSafe].balance[token];
  }

  /**
   * @dev determine whether the requested rate falls within the acceptable safety
   * margin
   * @param token the issuing token address
   * @param requestedRate the requested price of the issuing token in USD
   */

  function isAllowableRate(address token, uint256 requestedRate)
    public
    view
    returns (bool)
  {
    (uint256 actualRate, ) = exchangeRateOf(token);
    uint256 drift =
      actualRate > requestedRate
        ? actualRate.sub(requestedRate)
        : requestedRate.sub(actualRate);
    uint256 ten = 10;
    uint256 observedDriftPercentage =
      (drift.mul(ten**exchangeRateDecimals())).div(actualRate);
    return observedDriftPercentage <= rateDriftPercentage;
  }

  /**
   * @dev the decimals to use for the merchant fee percentage (the denominator of
   * the fraction used for the merchant fee percentage)
   */
  function merchantFeeDecimals() public pure returns (uint8) {
    return 8;
  }

  function makeAction(
    string memory actionName,
    address payable prepaidCard,
    address issuingToken,
    uint256 tokenAmount,
    uint256 spendAmount,
    uint256 requestedRate,
    bytes memory actionData
  ) internal pure returns (Action memory) {
    bytes32 nameHash = keccak256(abi.encodePacked(actionName));
    return
      Action(
        actionName,
        prepaidCard,
        issuingToken,
        tokenAmount,
        spendAmount,
        requestedRate,
        nameHash,
        actionData
      );
  }

  function dispatchAction(Action memory action) internal returns (bool) {
    validatePayment(
      action.issuingToken,
      action.tokenAmount,
      action.spendAmount,
      action.requestedRate
    );

    if (action.nameHash == keccak256(abi.encodePacked("registerMerchant"))) {
      return handleMerchantRegister(action);
    } else if (action.nameHash == keccak256(abi.encodePacked("payMerchant"))) {
      return handlePayment(action);
    } else {
      require(false, "invalid prepaid card action");
    }
  }

  /**
   * @dev register a merchant account
   * @param action the action object decoded from the onTransferToken
   * expecting data to be encoded as "(string)" where string is the info DID
   * for the merchant
   */
  function handleMerchantRegister(Action memory action)
    internal
    returns (bool)
  {
    uint256 merchantRegistrationFeeInToken =
      convertFromSpend(action.issuingToken, merchantRegistrationFeeInSPEND);
    require(
      action.tokenAmount >= merchantRegistrationFeeInToken,
      "Insufficient funds for merchant registration"
    );
    string memory infoDID = abi.decode(action.data, (string));
    // The merchantFeeReceiver is a trusted address
    IERC677(action.issuingToken).transfer(
      merchantFeeReceiver,
      merchantRegistrationFeeInToken
    );
    uint256 refund = action.tokenAmount.sub(merchantRegistrationFeeInToken);
    if (refund > 0) {
      // from is a trusted contract address (gnosis safe)
      IERC677(action.issuingToken).transfer(action.prepaidCard, refund);
    }

    address[] memory owners = GnosisSafe(action.prepaidCard).getOwners();
    require(owners.length == 2, "unexpected number of owners for prepaid card");

    address merchant = owners[0] == prepaidCardManager ? owners[1] : owners[0];
    emit CustomerPayment(
      action.prepaidCard,
      address(0),
      action.issuingToken,
      action.tokenAmount,
      merchantRegistrationFeeInSPEND
    );
    registerMerchant(merchant, infoDID);
    return true;
  }

  /**
   * @dev handle a prepaid card payment to a merchant which includes minting
   * spend into the merchant's safe, collecting protocol fees, and increases the
   * merchants unclaimed revenue by the issuing token amount minus fees
   * @param action the action object decoded from the onTransferToken
   * expecting data to be encoded as "(address)" where the address is the
   * merchant's safe address
   */
  function handlePayment(Action memory action) internal returns (bool) {
    address merchantSafe = abi.decode(action.data, (address));
    require(isMerchantSafe(merchantSafe), "Invalid merchant");

    uint256 ten = 10;
    uint256 merchantFee =
      merchantFeePercentage > 0
        ? (action.tokenAmount.mul(merchantFeePercentage)).div(
          ten**merchantFeeDecimals()
        )
        : 0;
    uint256 merchantProceeds = action.tokenAmount.sub(merchantFee);
    uint256 balance = merchantSafes[merchantSafe].balance[action.issuingToken];
    merchantSafes[merchantSafe].balance[action.issuingToken] = balance.add(
      merchantProceeds
    );
    merchantSafes[merchantSafe].tokens.add(action.issuingToken);

    ISPEND(spendToken).mint(merchantSafe, action.spendAmount);

    // The merchantFeeReceiver is a trusted address
    IERC677(action.issuingToken).transfer(merchantFeeReceiver, merchantFee);
    emit CustomerPayment(
      action.prepaidCard,
      merchantSafe,
      action.issuingToken,
      action.tokenAmount,
      action.spendAmount
    );
    emit MerchantFeeCollected(
      merchantSafe,
      action.prepaidCard,
      action.issuingToken,
      merchantFee
    );
    return true;
  }

  /**
   * @dev merchant claim token
   * @param merchantSafe address of merchant
   * @param token address of payable token
   * @param amount amount in payable token
   */
  function _claimRevenue(
    address merchantSafe,
    address token,
    uint256 amount
  ) internal isValidTokenAddress(token) returns (bool) {
    // ensure enough token for redeem
    uint256 balance = merchantSafes[merchantSafe].balance[token];
    require(amount <= balance, "Insufficient funds");

    // unlock token of merchant
    balance = balance.sub(amount);

    // update new balance
    merchantSafes[merchantSafe].balance[token] = balance;

    // transfer payable token from revenue pool to merchant's safe address. The
    // merchant's safe address is a gnosis safe contract, created by
    // registerMerchant(), so this is a trusted contract transfer
    IERC677(token).transfer(merchantSafe, amount);

    emit MerchantClaim(merchantSafe, token, amount);
    return true;
  }

  function validatePayment(
    address token,
    uint256 tokenAmount,
    uint256 spendAmount,
    uint256 requestedRate
  ) internal view returns (bool) {
    if (tokenAmount == 0 && spendAmount == 0) {
      return true;
    }
    uint256 expectedTokenAmount =
      convertFromSpendWithRate(token, spendAmount, requestedRate);
    require(
      expectedTokenAmount == tokenAmount,
      "amount received does not match requested rate"
    );
    require(
      isAllowableRate(token, requestedRate),
      "requested rate is beyond the allowable bounds"
    );
    return true;
  }
}
