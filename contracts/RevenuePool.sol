pragma solidity ^0.8.9;
pragma abicoder v1;

import "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import "./core/Ownable.sol";
import "./token/IERC677.sol";
import "./token/ISPEND.sol";
import "./Exchange.sol";
import "./core/Versionable.sol";
import "./MerchantManager.sol";
import "./PrepaidCardManager.sol";
import "./ActionDispatcher.sol";
import "./VersionManager.sol";

contract RevenuePool is Ownable, Versionable {
  using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

  struct RevenueBalance {
    EnumerableSetUpgradeable.AddressSet tokens;
    // mapping from token address to revenue pool balance for merchant in that
    // token
    mapping(address => uint256) balance;
  }
  address payable public merchantFeeReceiver;
  uint256 public merchantFeePercentage; // decimals 8
  uint256 public merchantRegistrationFeeInSPEND;
  address payable public prepaidCardManager;
  address public exchangeAddress;
  address public actionDispatcher;
  address public merchantManager;
  mapping(address => RevenueBalance) internal balances; // merchant safe address <=> balance info
  address public versionManager;

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

  /**
   * @dev set up revenue pool
   * @param _exchangeAddress the address of the Exchange contract
   * @param _merchantManager the address of the Merchant Manager contract
   * @param _actionDispatcher Action Dispatcher address
   * @param _prepaidCardManager the address of the PrepaidCardManager contract
   * @param _merchantFeeReceiver the address that receives the merchant fees
   * @param _merchantFeePercentage the numerator of a decimals 8 fraction that
   * represents the merchant fee percentage that is charged for each merchant
   * payment
   * @param _merchantRegistrationFeeInSPEND the amount in SPEND that is charged
   * for a merchant to register
   */
  function setup(
    address _exchangeAddress,
    address _merchantManager,
    address _actionDispatcher,
    address payable _prepaidCardManager,
    address payable _merchantFeeReceiver,
    uint256 _merchantFeePercentage,
    uint256 _merchantRegistrationFeeInSPEND,
    address _versionManager
  ) external onlyOwner {
    require(_merchantFeeReceiver != address(0), "merchantFeeReceiver not set");
    require(
      _merchantRegistrationFeeInSPEND > 0,
      "merchantRegistrationFeeInSPEND is not set"
    );
    merchantManager = _merchantManager;
    actionDispatcher = _actionDispatcher;
    exchangeAddress = _exchangeAddress;
    prepaidCardManager = _prepaidCardManager;
    merchantFeeReceiver = _merchantFeeReceiver;
    merchantFeePercentage = _merchantFeePercentage;
    merchantRegistrationFeeInSPEND = _merchantRegistrationFeeInSPEND;
    versionManager = _versionManager;
    emit Setup();
  }

  /**
   * @dev merchant claims revenue with their safe
   * @param payableToken address of payable token
   * @param amount amount in payable token
   */
  function claimRevenue(address payableToken, uint256 amount)
    external
    returns (bool)
  {
    require(
      MerchantManager(merchantManager).isMerchantSafe(msg.sender),
      "caller is not a merchant safe"
    );
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
    return balances[merchantSafe].tokens.values();
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
    return balances[merchantSafe].balance[token];
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
    uint256 balance = balances[merchantSafe].balance[token];
    balances[merchantSafe].balance[token] = balance + amount;
    balances[merchantSafe].tokens.add(token);
    return balances[merchantSafe].balance[token];
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
    uint256 balance = balances[merchantSafe].balance[token];
    require(amount <= balance, "Insufficient funds");

    // unlock token of merchant
    balance = balance - amount;

    // update new balance
    balances[merchantSafe].balance[token] = balance;

    // transfer payable token from revenue pool to merchant's safe address. The
    // merchant's safe address is a gnosis safe contract, created by
    // registerMerchant(), so this is a trusted contract transfer
    IERC677(token).transfer(merchantSafe, amount);

    emit MerchantClaim(merchantSafe, token, amount);
    return true;
  }

  function cardpayVersion() external view returns (string memory) {
    return VersionManager(versionManager).version();
  }
}
