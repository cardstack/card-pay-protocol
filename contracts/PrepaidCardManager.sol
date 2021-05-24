pragma solidity 0.5.17;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";

import "./token/IERC677.sol";
import "./roles/PayableToken.sol";
import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./RevenuePool.sol";

contract PrepaidCardManager is Initializable, Versionable, PayableToken, Safe {
  using SafeMath for uint256;
  struct CardDetail {
    address issuer;
    address issueToken;
    uint256 blockNumber;
    bool reloadable;
    bool canPayNonMerchants;
  }
  event Setup();
  event CreatePrepaidCard(
    address issuer,
    address card,
    address token,
    uint256 amount
  );
  event GasFeeCollected(
    address issuer,
    address card,
    address issuingToken,
    uint256 amount
  );
  event TransferredPrepaidCard(
    address prepaidCard,
    address previousOwner,
    address newOwner
  );

  bytes4 public constant SWAP_OWNER = 0xe318b52b; //swapOwner(address,address,address)
  bytes4 public constant TRANSER_AND_CALL = 0x4000aea0; //transferAndCall(address,uint256,bytes)
  uint8 public constant MAXIMUM_NUMBER_OF_CARD = 15;
  uint256 public constant MINIMUM_MERCHANT_PAYMENT = 50; //in units of SPEND
  address payable public revenuePool;
  address payable public gasFeeReceiver;
  mapping(address => CardDetail) public cardDetails;
  uint256 public gasFeeInCARD;
  uint256 internal maxAmount;
  uint256 internal minAmount;
  address public gasToken;

  /**
   * @dev Setup function sets initial storage of contract.
   * @param _gsMasterCopy Gnosis safe Master Copy address
   * @param _gsProxyFactory Gnosis safe Proxy Factory address
   * @param _revenuePool Revenue Pool address
   * @param _gasFeeReceiver The addres that will receive the new prepaid card gas fee
   * @param _gasFeeInCARD the amount to charge for the gas fee for new prepaid card in units of CARD wei
   * @param _payableTokens Payable tokens are allowed to use (these are created by the token bridge, specify them here if there are existing tokens breaked by teh bridge to use)
   * @param _minAmount The minimum face value of a new prepaid card in units of SPEND
   * @param _maxAmount The maximum face value of a new prepaid card in units of SPEND
   */
  function setup(
    address _gsMasterCopy,
    address _gsProxyFactory,
    address payable _revenuePool,
    address payable _gasFeeReceiver,
    uint256 _gasFeeInCARD,
    address[] calldata _payableTokens,
    address _gasToken,
    uint256 _minAmount,
    uint256 _maxAmount
  ) external onlyOwner {
    revenuePool = _revenuePool;
    gasFeeReceiver = _gasFeeReceiver;
    gasFeeInCARD = _gasFeeInCARD;

    Safe.setup(_gsMasterCopy, _gsProxyFactory);
    // set token list payable.
    for (uint256 i = 0; i < _payableTokens.length; i++) {
      _addPayableToken(_payableTokens[i]);
    }
    gasToken = _gasToken;
    // set limit of amount.
    minAmount = _minAmount;
    maxAmount = _maxAmount;
    emit Setup();
  }

  function minimumFaceValue() external view returns (uint256) {
    return minAmount;
  }

  function maximumFaceValue() external view returns (uint256) {
    return maxAmount;
  }

  /**
   * @dev check amount of card want to create.
   * convert amount to spend and check.
   */
  function isValidAmount(address token, uint256 amount)
    public
    view
    returns (bool)
  {
    uint256 amountInSPEND =
      RevenuePool(revenuePool).convertToSpend(token, amount - gasFee(token));
    return (minAmount <= amountInSPEND && amountInSPEND <= maxAmount);
  }

  /**
   * @dev Split Prepaid card
   * @param owner Supplier address
   * @param depot The Supplier's depot safe
   * @param token Token address
   * @param amountReceived Amount to split
   * @param amountOfCard array which performing face value of card
   */
  function createMultiplePrepaidCards(
    address owner,
    address depot,
    address token,
    uint256 amountReceived,
    uint256[] memory amountOfCard
  ) private returns (bool) {
    uint256 neededAmount = 0;
    uint256 numberCard = amountOfCard.length;

    require(
      numberCard <= MAXIMUM_NUMBER_OF_CARD,
      "Created too many prepaid cards"
    );

    for (uint256 i = 0; i < numberCard; i++) {
      require(isValidAmount(token, amountOfCard[i]), "Amount below threshold");
      neededAmount = neededAmount.add(amountOfCard[i]);
    }

    require(
      amountReceived >= neededAmount,
      "Insufficient funds sent for requested amounts"
    );
    for (uint256 i = 0; i < numberCard; i++) {
      createPrepaidCard(owner, token, amountOfCard[i]);
    }

    // refund the supplier any excess funds that they provided
    if (
      amountReceived > neededAmount &&
      // check to make sure ownerSafe address is a depot, so we can ensure it's
      // a trusted contract
      BridgeUtils(bridgeUtils).safes(depot) != address(0)
    ) {
      // the owner safe is a trusted contract (gnosis safe)
      IERC677(token).transfer(depot, amountReceived - neededAmount);
    }

    return true;
  }

  /**
   * @dev get the price in the specified token (in units of wei) to acheive the
   * specified face value in units of SPEND. Note that the face value will drift
   * afterwards based on the exchange rate
   */
  function priceForFaceValue(address token, uint256 spendFaceValue)
    external
    view
    returns (uint256)
  {
    return
      (RevenuePool(revenuePool).convertFromSpend(token, spendFaceValue))
        .add(gasFee(token))
        .add(100); // this is to deal with any rounding errors
  }

  /**
   * @dev sell card for customer
   * @param prepaidCard Prepaid Card's address
   * @param previousOwner previous owner of the prepaid card (the issuer)
   * @param newOwner the new owner of the prepaid card (the customer)
   * @param issuerSignatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
   */
  function sellCard(
    address payable prepaidCard,
    address previousOwner,
    address newOwner,
    bytes calldata issuerSignatures
  ) external payable returns (bool) {
    require(
      cardDetails[prepaidCard].issuer == previousOwner,
      "Has already been transferred"
    );
    execTransaction(
      prepaidCard,
      prepaidCard,
      getSellCardData(previousOwner, newOwner),
      issuerSignatures,
      address(0),
      address(0)
    );
    emit TransferredPrepaidCard(prepaidCard, previousOwner, newOwner);

    return true;
  }

  /**
   * @dev Returns the bytes that are hashed to be signed by owners
   * @param from Ower of card
   * @param to Customer's address
   */
  function getSellCardData(address from, address to)
    public
    view
    returns (bytes memory)
  {
    // Swap owner
    return abi.encodeWithSelector(SWAP_OWNER, address(this), from, to);
  }

  /**
   * Contract Signature
   * signature type == 1
   * s = ignored
   * r = contract address with padding to 32 bytes
   * {32-bytes r}{32-bytes s}{1-byte signature type}
   * Should use it offchain ?
   */
  function getContractSignature()
    public
    view
    returns (bytes memory contractSignature)
  {
    // Create signature
    contractSignature = new bytes(65);
    bytes memory encodeData = abi.encode(this, address(0));
    for (uint256 i = 1; i <= 64; i++) {
      contractSignature[64 - i] = encodeData[encodeData.length.sub(i)];
    }
    bytes1 v = 0x01;
    contractSignature[64] = v;
  }

  /**
   * @dev append owner's signature with Prepaid Card Admin's Signature
   * @param owner Owner's address
   * @param signature Owner's signature
   * Should use it offchain ?
   */
  function appendPrepaidCardAdminSignature(
    address owner,
    bytes memory signature
  ) public view returns (bytes memory signatures) {
    require(signature.length == 65, "Invalid signature!");

    // Create signatures
    bytes memory contractSignature = getContractSignature();

    signatures = new bytes(130);
    // Gnosis safe require signature must be sort by owner' address
    if (address(this) > owner) {
      for (uint256 i = 0; i < signature.length; i++) {
        signatures[i] = signature[i];
      }
      for (uint256 i = 0; i < contractSignature.length; i++) {
        signatures[i.add(65)] = contractSignature[i];
      }
    } else {
      for (uint256 i = 0; i < contractSignature.length; i++) {
        signatures[i] = contractSignature[i];
      }
      for (uint256 i = 0; i < signature.length; i++) {
        signatures[i.add(65)] = signature[i];
      }
    }
  }

  /**
   * @dev Pay token to merchant
   * @param prepaidCard Prepaid Card's address
   * @param payableTokenAddr payable token address
   * @param merchantSafe Merchant's safe address
   * @param amount value to pay to merchant
   * @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
   * TODO: relayer should verify request will fulfill the requires() before calling this method
   */
  function payForMerchant(
    address payable prepaidCard,
    address payableTokenAddr,
    address merchantSafe,
    uint256 amount,
    bytes calldata signatures
  ) external returns (bool) {
    require(gasToken != address(0), "gasToken not configured");
    require(
      cardDetails[prepaidCard].blockNumber < block.number,
      "Prepaid card used too soon"
    );
    uint256 amountInSPEND =
      RevenuePool(revenuePool).convertToSpend(payableTokenAddr, amount);
    require(
      amountInSPEND >= MINIMUM_MERCHANT_PAYMENT,
      "merchant payment too small"
    ); // protect against spamming contract with too low a price
    return
      execTransaction(
        prepaidCard,
        payableTokenAddr,
        getPayData(payableTokenAddr, merchantSafe, amount),
        signatures,
        gasToken,
        prepaidCard
      );
  }

  /**
   * @dev Returns the bytes that are hashed to be signed by owners.
   * @param token Token merchant
   * @param merchantSafe Merchant's safe address
   * @param amount amount need pay to merchant
   */
  function getPayData(
    address token, // solhint-disable-line no-unused-vars
    address merchantSafe,
    uint256 amount
  ) public view returns (bytes memory) {
    return
      abi.encodeWithSelector(
        TRANSER_AND_CALL,
        revenuePool,
        amount,
        abi.encode(merchantSafe)
      );
  }

  /**
   * @dev onTokenTransfer(ERC677) - call when token send this contract.
   * @param from Supplier or Prepaid card address
   * @param amount number token them transfer.
   * @param data data encoded
   */
  function onTokenTransfer(
    address from, // solhint-disable-line no-unused-vars
    uint256 amount,
    bytes calldata data
  ) external isValidToken returns (bool) {
    (address owner, uint256[] memory cardAmounts) =
      abi.decode(data, (address, uint256[]));

    require(
      owner != address(0) && cardAmounts.length > 0,
      "Prepaid card data invalid"
    );

    createMultiplePrepaidCards(owner, from, _msgSender(), amount, cardAmounts);

    return true;
  }

  /**
   * @dev Returns the bytes that are hashed to be signed by owners.
   * @param cardOwner owner of prepaid card
   * @param subCardAmount Array of new card's amount
   */
  function getSplitCardData(address cardOwner, uint256[] memory subCardAmount)
    public
    view
    returns (bytes memory)
  {
    uint256 total = 0;

    for (uint256 i = 0; i < subCardAmount.length; i++) {
      total = total.add(subCardAmount[i]);
    }

    // Transfer token to this contract and call _createMultiplePrepaidCards
    return
      abi.encodeWithSelector(
        TRANSER_AND_CALL,
        address(this),
        total,
        abi.encode(cardOwner, subCardAmount)
      );
  }

  /**
   * @dev Split Current Prepaid Card into Multiple Cards
   * @param prepaidCard Prepaid Card's address
   * @param owner Owner of card
   * @param issueToken Token's address
   * @param cardAmounts Array of new card's amount
   * @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
   */
  function splitCard(
    address payable prepaidCard,
    address owner,
    address issueToken,
    uint256[] calldata cardAmounts,
    bytes calldata signatures
  ) external payable returns (bool) {
    return
      execTransaction(
        prepaidCard,
        issueToken,
        getSplitCardData(owner, cardAmounts),
        signatures,
        address(0),
        address(0)
      );
  }

  function gasFee(address token) public view returns (uint256) {
    if (gasFeeReceiver == address(0)) {
      return 0;
    } else {
      return RevenuePool(revenuePool).convertFromCARD(token, gasFeeInCARD);
    }
  }

  /**
   * @dev Create Prepaid card
   * @param owner owner address
   * @param token token address
   * @param amount amount of prepaid card
   * @return PrepaidCard address
   */
  function createPrepaidCard(
    address owner,
    address token,
    uint256 amount
  ) private returns (address) {
    address[] memory owners = new address[](2);

    owners[0] = address(this);
    owners[1] = owner;

    address card = createSafe(owners, 2);

    // card was created
    cardDetails[card].issuer = owner;
    cardDetails[card].issueToken = token;
    cardDetails[card].blockNumber = block.number;
    cardDetails[card].reloadable = false; // future functionality
    cardDetails[card].canPayNonMerchants = false; // future functionality
    uint256 _gasFee = gasFee(token);
    if (gasFeeReceiver != address(0) && _gasFee > 0) {
      // The gasFeeReceiver is a trusted address that we control
      IERC677(token).transfer(gasFeeReceiver, _gasFee);
    }
    // The card is a trusted contract (gnosis safe)
    IERC677(token).transfer(card, amount - _gasFee);

    emit CreatePrepaidCard(owner, card, token, amount - _gasFee);
    emit GasFeeCollected(owner, card, token, _gasFee);

    return card;
  }

  /**
   * @dev adapter execTransaction for prepaid card(gnosis safe)
   * @param card Prepaid Card's address
   * @param to Destination address of Safe transaction
   * @param data Data payload of Safe transaction
   * @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
   */
  function execTransaction(
    address payable card,
    address to,
    bytes memory data,
    bytes memory signatures,
    address _gasToken,
    address payable _gasRecipient
  ) private returns (bool) {
    require(
      GnosisSafe(card).execTransaction(
        to,
        0,
        data,
        Enum.Operation.Call,
        0,
        0,
        0,
        _gasToken,
        _gasRecipient,
        signatures
      ),
      "safe transaction was reverted"
    );

    return true;
  }
}
