pragma solidity 0.5.17;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/contract-upgradeable/contracts/ownership/Ownable.sol";

import "./token/IERC677.sol";
import "./TokenManager.sol";
import "./core/Safe.sol";
import "./core/Versionable.sol";
import "./SupplierManager.sol";
import "./Exchange.sol";
import "./ActionDispatcher.sol";

contract PrepaidCardManager is Ownable, Versionable, Safe {
  using SafeMath for uint256;
  using EnumerableSet for EnumerableSet.AddressSet;

  struct CardDetail {
    address issuer;
    address issueToken;
    uint256 blockNumber;
    string customizationDID;
    bool reloadable;
    bool canPayNonMerchants;
  }
  struct GasPolicy {
    bool useIssuingTokenForGas;
    bool payGasRecipient;
  }
  struct MaterializedGasPolicy {
    address gasToken;
    address gasReceiver;
  }

  event Setup();
  event CreatePrepaidCard(
    address issuer,
    address card,
    address token,
    address createdFromDepot,
    uint256 issuingTokenAmount,
    uint256 spendAmount,
    uint256 gasFeeCollected,
    string customizationDID
  );
  event TransferredPrepaidCard(
    address prepaidCard,
    address previousOwner,
    address newOwner
  );
  event GasPolicyAdded(
    string action,
    bool useIssuingTokenForGas,
    bool payGasRecipient
  );
  event ContractSignerRemoved(address signer);

  bytes4 public constant SWAP_OWNER = 0xe318b52b; //swapOwner(address,address,address)
  bytes4 public constant TRANSFER_AND_CALL = 0x4000aea0; //transferAndCall(address,uint256,bytes)
  uint8 public constant MAXIMUM_NUMBER_OF_CARD = 15;
  uint256 public constant MINIMUM_MERCHANT_PAYMENT = 50; //in units of SPEND
  address payable public actionDispatcher;
  address payable public gasFeeReceiver;
  mapping(address => CardDetail) public cardDetails;
  uint256 public gasFeeInCARD;
  uint256 public maximumFaceValue;
  uint256 public minimumFaceValue;
  address public gasToken;
  address public exchangeAddress;
  address public tokenManager;
  address public supplierManager;
  mapping(string => GasPolicy) public gasPolicies;
  mapping(address => bool) public hasBeenSplit; // this is deprecated, remove it if possible
  mapping(address => bool) public hasBeenUsed;
  EnumerableSet.AddressSet internal contractSigners;

  modifier onlyHandlers() {
    require(
      ActionDispatcher(actionDispatcher).isHandler(msg.sender),
      "caller is not a registered action handler"
    );
    _;
  }
  modifier onlyHandlersAndContractSigners() {
    require(
      ActionDispatcher(actionDispatcher).isHandler(msg.sender) ||
        contractSigners.contains(msg.sender),
      "caller is not a registered action handler nor contract signer"
    );
    _;
  }

  /**
   * @dev Setup function sets initial storage of contract.
   * @param _tokenManager the address of the Token Manager contract
   * @param _supplierManager the address of the Supplier Manager contract
   * @param _exchangeAddress the address of the Exchange contract
   * @param _gsMasterCopy Gnosis safe Master Copy address
   * @param _gsProxyFactory Gnosis safe Proxy Factory address
   * @param _actionDispatcher Action Dispatcher address
   * @param _gasFeeReceiver The addres that will receive the new prepaid card gas fee
   * @param _gasFeeInCARD the amount to charge for the gas fee for new prepaid card in units of CARD wei
   * @param _minAmount The minimum face value of a new prepaid card in units of SPEND
   * @param _maxAmount The maximum face value of a new prepaid card in units of SPEND
   */
  function setup(
    address _tokenManager,
    address _supplierManager,
    address _exchangeAddress,
    address _gsMasterCopy,
    address _gsProxyFactory,
    address payable _actionDispatcher,
    address payable _gasFeeReceiver,
    uint256 _gasFeeInCARD,
    address _gasToken,
    uint256 _minAmount,
    uint256 _maxAmount,
    address[] calldata _contractSigners
  ) external onlyOwner {
    actionDispatcher = _actionDispatcher;
    supplierManager = _supplierManager;
    tokenManager = _tokenManager;
    exchangeAddress = _exchangeAddress;
    gasFeeReceiver = _gasFeeReceiver;
    gasFeeInCARD = _gasFeeInCARD;
    gasToken = _gasToken;
    minimumFaceValue = _minAmount;
    maximumFaceValue = _maxAmount;
    Safe.setup(_gsMasterCopy, _gsProxyFactory);
    for (uint256 i = 0; i < _contractSigners.length; i++) {
      contractSigners.add(_contractSigners[i]);
    }
    emit Setup();
  }

  /**
   * @dev Adds a new gas policy for a send action
   * @param action the send action the policy is for
   * @param useIssuingTokenForGas true if we want to use the issuing token for
   * the prepaid card to pay for gas. This has the effect of deducting from the
   * face value of the card. If false, then we use the gas token (CARD.CPXD) to
   * pay for gas.
   * @param payGasRecipient true if we want the gas recipient (the relay server
   * txn funder) to recieve the gas payment. If false, then the prepaid card will
   * pay itself for gas and we'll recoup the gas via some other means (e.g.
   * merchant fees)
   */
  function addGasPolicy(
    string calldata action,
    bool useIssuingTokenForGas,
    bool payGasRecipient
  ) external onlyOwner returns (bool) {
    gasPolicies[action].useIssuingTokenForGas = useIssuingTokenForGas;
    gasPolicies[action].payGasRecipient = payGasRecipient;
    emit GasPolicyAdded(action, useIssuingTokenForGas, payGasRecipient);
    return true;
  }

  function removeContractSigner(address signer) external onlyOwner {
    contractSigners.remove(signer);
    emit ContractSignerRemoved(signer);
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
  ) external returns (bool) {
    require(
      TokenManager(tokenManager).isValidToken(msg.sender),
      "calling token is unaccepted"
    );
    (
      address owner,
      uint256[] memory issuingTokenAmounts,
      uint256[] memory spendAmounts,
      string memory customizationDID
    ) = abi.decode(data, (address, uint256[], uint256[], string));
    require(
      owner != address(0) && issuingTokenAmounts.length > 0,
      "Prepaid card data invalid"
    );
    require(
      issuingTokenAmounts.length == spendAmounts.length,
      "the amount arrays have differing lengths"
    );

    // The spend amounts are for reporting purposes only, there is no on-chain
    // effect from this value. Although, it might not be a bad idea that spend
    // amounts line up with the issuing token amounts--albiet we'd need to
    // introduce a rate lock mechanism if we wanted to validate this
    createMultiplePrepaidCards(
      owner,
      from,
      _msgSender(),
      amount,
      issuingTokenAmounts,
      spendAmounts,
      customizationDID
    );
    return true;
  }

  function setPrepaidCardUsed(address prepaidCard)
    external
    onlyHandlers
    returns (bool)
  {
    hasBeenUsed[prepaidCard] = true;
    return true;
  }

  /**
   * @dev returns the face value for the prepaid card as units of SPEND.
   * @param prepaidCard the address of the prepaid card for which to get a face value
   */
  function faceValue(address prepaidCard) external view returns (uint256) {
    address issuingToken = cardDetails[prepaidCard].issueToken;
    uint256 issuingTokenBalance = IERC677(issuingToken).balanceOf(prepaidCard);
    Exchange exchange = Exchange(exchangeAddress);
    return exchange.convertToSpend(issuingToken, issuingTokenBalance);
  }

  /**
   * @dev get the price in the specified token (in units of wei) to acheive the
   * specified face value in units of SPEND. Note that the face value will drift
   * afterwards based on the exchange rate
   * @param token the issuing token for the prepaid card
   * @param spendFaceValue the desired face value for the prepaid card
   */
  function priceForFaceValue(address token, uint256 spendFaceValue)
    external
    view
    returns (uint256)
  {
    return
      (Exchange(exchangeAddress).convertFromSpend(token, spendFaceValue))
        .add(gasFee(token))
        .add(100); // this is to deal with any rounding errors
  }

  /**
   * @dev get the addresses that are configured as EIP-1271 signers for prepaid cards
   */
  function getContractSigners() external view returns (address[] memory) {
    return contractSigners.enumerate();
  }

  /**
   * @dev returns a boolean indicating if the prepaid card's owner is an EIP-1271 signer
   * @param prepaidCard prepaid card address
   */
  function isEIP1271Signer(address payable prepaidCard)
    public
    view
    returns (bool)
  {
    return contractSigners.contains(getPrepaidCardOwner(prepaidCard));
  }

  /**
   * @dev Pay token to merchant
   * @param prepaidCard Prepaid Card's address
   * @param spendAmount The amount of SPEND to send
   * @param rateLock the price of the issuing token in USD
   * @param action the name of the prepaid card action to perform, e.g. "payMerchant", "registerMerchant", "claimRevenue", etc.
   * @param data encoded data that is specific to the action being performed, e.g. the merchant safe address for the "payMerchant" action, the info DID for the "registerMerchant", etc.
   * @param ownerSignature Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
   */
  function send(
    address payable prepaidCard,
    uint256 spendAmount,
    uint256 rateLock,
    string calldata action,
    bytes calldata data,
    bytes calldata ownerSignature
  ) external returns (bool) {
    require(gasToken != address(0), "gasToken not configured");
    require(
      cardDetails[prepaidCard].blockNumber < block.number,
      "prepaid card used too soon"
    );
    require(
      Exchange(exchangeAddress).isAllowableRate(
        cardDetails[prepaidCard].issueToken,
        rateLock
      ),
      "requested rate is beyond the allowable bounds"
    );
    MaterializedGasPolicy memory gasPolicy =
      getMaterializedGasPolicy(action, prepaidCard);
    return
      execTransaction(
        prepaidCard,
        cardDetails[prepaidCard].issueToken,
        getSendData(prepaidCard, spendAmount, rateLock, action, data),
        isEIP1271Signer(prepaidCard)
          ? appendToEIP1271Signature(prepaidCard, ownerSignature)
          : addOwnSignature(prepaidCard, ownerSignature),
        gasPolicy.gasToken,
        address(uint160(gasPolicy.gasReceiver))
      );
  }

  /**
   * @dev Returns the bytes that are hashed to be signed by owner.
   * @param prepaidCard The prepaid card to use for sending
   * @param spendAmount The amount of SPEND to pay the merchant
   * @param rateLock the price of the issuing token in USD
   * @param action the name of the prepaid card action to perform, e.g. "payMerchant", "registerMerchant", "claimRevenue", etc.
   * @param data encoded data that is specific to the action being performed, e.g. the merchant safe address for the "payMerchant" action, the info DID for the "registerMerchant", etc.
   */
  function getSendData(
    address payable prepaidCard,
    uint256 spendAmount,
    uint256 rateLock,
    string memory action,
    bytes memory data
  ) public view returns (bytes memory) {
    uint256 tokenAmount =
      Exchange(exchangeAddress).convertFromSpendWithRate(
        cardDetails[prepaidCard].issueToken,
        spendAmount,
        rateLock
      );
    return
      abi.encodeWithSelector(
        TRANSFER_AND_CALL,
        actionDispatcher,
        tokenAmount,
        abi.encode(spendAmount, rateLock, action, data)
      );
  }

  /**
   * @dev sell card for customer
   * @param prepaidCard Prepaid Card's address
   * @param newOwner the new owner of the prepaid card (the customer)
   * @param previousOwnerSignature Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
   */
  function transfer(
    address payable prepaidCard,
    address newOwner,
    bytes calldata previousOwnerSignature
  ) external onlyHandlersAndContractSigners returns (bool) {
    address previousOwner = getPrepaidCardOwner(prepaidCard);
    require(
      cardDetails[prepaidCard].issuer == previousOwner ||
        contractSigners.contains(previousOwner),
      "Has already been transferred"
    );
    require(
      !hasBeenUsed[prepaidCard],
      "Cannot transfer prepaid card that has already been used"
    );
    MaterializedGasPolicy memory gasPolicy =
      getMaterializedGasPolicy("transfer", prepaidCard);
    execTransaction(
      prepaidCard,
      prepaidCard,
      getTransferCardData(prepaidCard, newOwner),
      isEIP1271Signer(prepaidCard)
        ? appendToEIP1271Signature(prepaidCard, previousOwnerSignature)
        : addOwnSignature(prepaidCard, previousOwnerSignature),
      gasPolicy.gasToken,
      address(uint160(gasPolicy.gasReceiver))
    );
    emit TransferredPrepaidCard(prepaidCard, previousOwner, newOwner);

    return true;
  }

  /**
   * @dev Returns the bytes that are hashed to be signed by owner
   * @param prepaidCard the prepaid card address
   * @param newOwner Customer's address
   */
  function getTransferCardData(address payable prepaidCard, address newOwner)
    public
    view
    returns (bytes memory)
  {
    // Swap owner
    address oldOwner = getPrepaidCardOwner(prepaidCard);
    return
      abi.encodeWithSelector(SWAP_OWNER, address(this), oldOwner, newOwner);
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
      Exchange(exchangeAddress).convertToSpend(token, amount - gasFee(token));
    return (minimumFaceValue <= amountInSPEND &&
      amountInSPEND <= maximumFaceValue);
  }

  function gasFee(address token) public view returns (uint256) {
    if (gasFeeReceiver == address(0)) {
      return 0;
    } else {
      return Exchange(exchangeAddress).convertFromCARD(token, gasFeeInCARD);
    }
  }

  function getPrepaidCardOwner(address payable prepaidCard)
    public
    view
    returns (address)
  {
    address[] memory owners = GnosisSafe(prepaidCard).getOwners();
    require(owners.length == 2, "unexpected number of owners for prepaid card");
    return owners[0] == address(this) ? owners[1] : owners[0];
  }

  function getPrepaidCardIssuer(address prepaidCard)
    public
    view
    returns (address)
  {
    return cardDetails[prepaidCard].issuer;
  }

  /**
   * @dev Split Prepaid card
   * @param owner Supplier address
   * @param depot The Supplier's depot safe
   * @param token Token address
   * @param amountReceived Amount to split
   * @param issuingTokenAmounts array of issuing token amounts to use to fund the creation of the prepaid card
   * @param spendAmounts array of spend amounts that represent the desired face value (for reporting only)
   * @param customizationDID the customization DID for the new prepaid cards
   */
  function createMultiplePrepaidCards(
    address owner,
    address depot,
    address token,
    uint256 amountReceived,
    uint256[] memory issuingTokenAmounts,
    uint256[] memory spendAmounts,
    string memory customizationDID
  ) private returns (bool) {
    uint256 neededAmount = 0;
    uint256 numberCard = issuingTokenAmounts.length;
    require(
      numberCard <= MAXIMUM_NUMBER_OF_CARD,
      "Too many prepaid cards requested"
    );

    for (uint256 i = 0; i < numberCard; i++) {
      require(
        isValidAmount(token, issuingTokenAmounts[i]),
        "Amount below threshold"
      );
      neededAmount = neededAmount.add(issuingTokenAmounts[i]);
    }

    require(
      amountReceived >= neededAmount,
      "Insufficient funds sent for requested amounts"
    );
    for (uint256 i = 0; i < numberCard; i++) {
      createPrepaidCard(
        owner,
        depot,
        token,
        issuingTokenAmounts[i],
        spendAmounts[i],
        customizationDID
      );
    }

    // refund the supplier any excess funds that they provided
    if (
      amountReceived > neededAmount &&
      // check to make sure ownerSafe address is a depot, so we can ensure it's
      // a trusted contract
      SupplierManager(supplierManager).safes(depot) != address(0)
    ) {
      // the owner safe is a trusted contract (gnosis safe)
      IERC677(token).transfer(depot, amountReceived.sub(neededAmount));
    }

    return true;
  }

  /**
   * @dev Create Prepaid card
   * @param owner owner address
   * @param token token address
   * @param issuingTokenAmount amount of issuing token to use to fund the new prepaid card
   * @param spendAmount the desired face value for the new prepaid card (for reporting purposes only)
   * @param customizationDID the customization DID for the new prepaid cards
   * @return PrepaidCard address
   */
  function createPrepaidCard(
    address owner,
    address depot,
    address token,
    uint256 issuingTokenAmount,
    uint256 spendAmount,
    string memory customizationDID
  ) private returns (address) {
    address[] memory owners = new address[](2);

    owners[0] = address(this);
    owners[1] = owner;

    address card = createSafe(owners, 2);

    // card was created
    cardDetails[card].issuer = owner;
    cardDetails[card].issueToken = token;
    cardDetails[card].customizationDID = customizationDID;
    cardDetails[card].blockNumber = block.number;
    cardDetails[card].reloadable = false; // future functionality
    cardDetails[card].canPayNonMerchants = false; // future functionality
    uint256 _gasFee = gasFee(token);
    if (gasFeeReceiver != address(0) && _gasFee > 0) {
      // The gasFeeReceiver is a trusted address that we control
      IERC677(token).transfer(gasFeeReceiver, _gasFee);
    }
    // The card is a trusted contract (gnosis safe)
    IERC677(token).transfer(card, issuingTokenAmount.sub(_gasFee));

    emit CreatePrepaidCard(
      owner,
      card,
      token,
      depot,
      issuingTokenAmount.sub(_gasFee),
      spendAmount,
      _gasFee,
      customizationDID
    );

    return card;
  }

  /**
   * @dev adapter execTransaction for prepaid card(gnosis safe)
   * @param prepaidCard Prepaid Card's address
   * @param to Destination address of Safe transaction
   * @param data Data payload of Safe transaction
   * @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
   * @param _gasToken The token to use to pay for gas
   * @param _gasRecipient the address that should receive the gas payment
   * (address(0) is used to specify the relay txn funder)
   */
  function execTransaction(
    address payable prepaidCard,
    address to,
    bytes memory data,
    bytes memory signatures,
    address _gasToken,
    address payable _gasRecipient
  ) private returns (bool) {
    require(
      GnosisSafe(prepaidCard).execTransaction(
        to,
        0,
        data,
        Enum.Operation.Call,
        0,
        0,
        0, //If there is no gas price, there will be no transfer to _gasRecipient
        _gasToken,
        _gasRecipient,
        signatures
      ),
      "safe transaction was reverted"
    );

    return true;
  }

  function getMaterializedGasPolicy(string memory action, address prepaidCard)
    internal
    view
    returns (MaterializedGasPolicy memory)
  {
    return
      MaterializedGasPolicy(
        gasPolicies[action].useIssuingTokenForGas
          ? cardDetails[prepaidCard].issueToken
          : gasToken,
        gasPolicies[action].payGasRecipient ? address(0) : prepaidCard
      );
  }

  /**
   * We are using a Prevalidated Signature (v = 1) type of signature for
   * signing from this contract (as opposed to EIP-1271, v = 0).
   * https://docs.gnosis.io/safe/docs/contracts_signatures/#pre-validated-signatures
   * This particular type of signature is a "pre-approved" signature. This
   * signature is considered valid only when the sender of gnosis safe exec
   * txn is the address within the signature or a GnosisSafe.approveHash() has
   * been called from the address within the signature on the safe in
   * question. In our case, since this contract issues
   * GnosisSafe.execTransaction() (in the execTransaction() function), we can
   * take advantage of the fact that all gnosis safe txn's will be sent from
   * this contract's address.
   *
   * signature type == 1
   * s = ignored
   * r = contract address with padding to 32 bytes
   * {32-bytes r}{32-bytes s}{1-byte signature type}
   */
  function getOwnSignature()
    internal
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
   * @dev Append the contract's own signature to the EOA signature we received from
   * the safe owner
   * @param prepaidCard the prepaid card address
   * @param signature Owner's EOA signature
   */
  function addOwnSignature(address payable prepaidCard, bytes memory signature)
    internal
    view
    returns (bytes memory signatures)
  {
    require(signature.length == 65, "Invalid signature!");

    address owner = getPrepaidCardOwner(prepaidCard);
    bytes memory ownSignature = getOwnSignature();
    signatures = new bytes(130); // 2 x 65 bytes
    // Gnosis safe signatures must be sorted by owners' address.
    if (address(this) > owner) {
      signatures = abi.encodePacked(signature, ownSignature);
    } else {
      signatures = abi.encodePacked(ownSignature, signature);
    }
  }

  /**
   * @dev Append the contract's own signature to an EIP-1271 signature we received from
   * the safe owner
   * @param prepaidCard the prepaid card address
   * @param signature Owner's EIP-1271 signature data
   */
  function appendToEIP1271Signature(
    address payable prepaidCard,
    bytes memory signature
  ) public view returns (bytes memory signatures) {
    address owner = getPrepaidCardOwner(prepaidCard);
    bytes memory ownSignature = getOwnSignature();
    uint256 eip1271SignatureLength = signature.length;
    bytes1 v = 0x00;
    // R,S,V vector for EIP-1271 signature where
    // R = the owner address
    // S = the byte offset to find the signature data
    //     which is 2 x 65 bytes because the threshold
    //     is 2 and each RSV vector is 65 bytes
    // V = signature type, 0x00 is for EIP-1271 signatures
    bytes memory eip1271RSV =
      abi.encodePacked(abi.encode(owner), abi.encode(uint256(130)), v);

    // Gnosis safe signatures must be sorted by owners' address. and
    // additionally EIP-1271 signatures should conclude with 32 bytes for the
    // EIP-1271 signature length, and then finally the actual EIP-1271 signature
    // data itself
    if (address(this) > owner) {
      signatures = abi.encodePacked(
        eip1271RSV,
        ownSignature,
        eip1271SignatureLength,
        signature
      );
    } else {
      signatures = abi.encodePacked(
        ownSignature,
        eip1271RSV,
        eip1271SignatureLength,
        signature
      );
    }
  }
}
