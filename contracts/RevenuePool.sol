pragma solidity 0.5.17;

import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";

import "./token/IERC677.sol";
import "./token/ISPEND.sol";
import "./core/MerchantManager.sol";
import "./Exchange.sol";
import "./core/Versionable.sol";
import "./PrepaidCardManager.sol";
import "./ActionDispatcher.sol";

contract RevenuePool is Ownable, Versionable, MerchantManager {
  using SafeMath for uint256;

  address payable public merchantFeeReceiver;
  uint256 public merchantFeePercentage; // decimals 8
  uint256 public merchantRegistrationFeeInSPEND;
  address payable public prepaidCardManager;
  address public exchangeAddress;
  address public actionDispatcher;

  event Setup();
  event MerchantClaim(
    address merchantSafe,
    address payableToken,
    uint256 amount
  );

  modifier onlyHandlers() {
    require(
      ActionDispatcher(actionDispatcher).isHandler(msg.sender),
      "caller is not a registered action handler"
    );
    _;
  }

  modifier onlyHandlersOrOwner() {
    require(
      isOwner() || ActionDispatcher(actionDispatcher).isHandler(msg.sender),
      "caller is not a registered action handler nor an owner"
    );
    _;
  }

  /**
   * @dev set up revenue pool
   * @param _exchangeAddress the address of the Exchange contract
   * @param _actionDispatcher Action Dispatcher address
   * @param _prepaidCardManager the address of the PrepaidCardManager contract
   * @param _gsMasterCopy is masterCopy address
   * @param _gsProxyFactory is gnosis proxy factory address.
   * @param _merchantFeeReceiver the address that receives the merchant fees
   * @param _merchantFeePercentage the numerator of a decimals 8 fraction that
   * represents the merchant fee percentage that is charged for each merchant
   * payment
   * @param _merchantRegistrationFeeInSPEND the amount in SPEND that is charged
   * for a merchant to register
   */
  function setup(
    address _exchangeAddress,
    address _actionDispatcher,
    address payable _prepaidCardManager,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address payable _merchantFeeReceiver,
    uint256 _merchantFeePercentage,
    uint256 _merchantRegistrationFeeInSPEND
  ) external onlyOwner {
    require(_merchantFeeReceiver != address(0), "merchantFeeReceiver not set");
    require(
      _merchantRegistrationFeeInSPEND > 0,
      "merchantRegistrationFeeInSPEND is not set"
    );
    // setup gnosis safe address
    MerchantManager.setup(_gsMasterCopy, _gsProxyFactory);

    actionDispatcher = _actionDispatcher;
    exchangeAddress = _exchangeAddress;
    prepaidCardManager = _prepaidCardManager;
    merchantFeeReceiver = _merchantFeeReceiver;
    merchantFeePercentage = _merchantFeePercentage;
    merchantRegistrationFeeInSPEND = _merchantRegistrationFeeInSPEND;
    emit Setup();
  }

  function addMerchant(address merchantAddress, string calldata infoDID)
    external
    onlyHandlersOrOwner
    returns (address)
  {
    return registerMerchant(merchantAddress, infoDID);
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
   * @dev the decimals to use for the merchant fee percentage (the denominator of
   * the fraction used for the merchant fee percentage)
   */
  function merchantFeeDecimals() public pure returns (uint8) {
    return 8;
  }

  function addToMerchantBalance(
    address merchantSafe,
    address token,
    uint256 amount
  ) external onlyHandlers returns (uint256) {
    uint256 balance = merchantSafes[merchantSafe].balance[token];
    merchantSafes[merchantSafe].balance[token] = balance.add(amount);
    merchantSafes[merchantSafe].tokens.add(token);
    return merchantSafes[merchantSafe].balance[token];
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
  ) internal returns (bool) {
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
}
