pragma solidity 0.5.17;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contract-upgradeable/contracts/math/SafeMath.sol";
import "@openzeppelin/upgrades/contracts/Initializable.sol";

import "./token/IERC677.sol";
import "./roles/TallyRole.sol";
import "./roles/PayableToken.sol";
import "./core/Safe.sol";
import "./interfaces/IPrepaidCardManager.sol";
import "./RevenuePool.sol";


contract PrepaidCardManager is
    Initializable,
    TallyRole,
    PayableToken,
    Safe,
    IPrepaidCardManager
{
    bytes4 public constant SWAP_OWNER = 0xe318b52b; //swapOwner(address,address,address)
    bytes4 public constant TRANSER_AND_CALL = 0x4000aea0; //transferAndCall(address,uint256,bytes)
    uint8 public constant MAXIMUM_NUMBER_OF_CARD = 15;

    using SafeMath for uint256;

    event CreatePrepaidCard(
        address issuer,
        address card,
        address token,
        uint256 amount
    );

    address public revenuePool;

    uint256 internal maxAmount;
    uint256 internal minAmount;

    mapping(address => CardDetail) public cardDetails;

    /**
     * @dev Setup function sets initial storage of contract.
     * @param _tally Tally address
     * @param _gsMasterCopy Gnosis safe Master Copy address
     * @param _gsProxyFactory Gnosis safe Proxy Factory address
     * @param _revenuePool Revenue Pool address
     * @param _payableTokens Payable tokens are allowed to use
     */
    function setup(
        address _tally,
        address _gsMasterCopy,
        address _gsProxyFactory,
        address _revenuePool,
        address[] memory _payableTokens,
        uint256 _minAmount,
        uint256 _maxAmount
    ) public onlyOwner {
        // setup tally user
        _addTally(_tally);

        revenuePool = _revenuePool;

        Safe.setup(_gsMasterCopy, _gsProxyFactory);
        // set token list payable.
        for (uint256 i = 0; i < _payableTokens.length; i++) {
            _addPayableToken(_payableTokens[i]);
        }
        // set limit of amount.
        minAmount = _minAmount;
        maxAmount = _maxAmount;
    }

    function getMinimumAmount() public view returns (uint256) {
        return minAmount;
    }

    function getMaximumAmount() public view returns (uint256) {
        return maxAmount;
    }

    function updateMinimumAmount(uint256 _minValue) public onlyTally {
        minAmount = _minValue;
    }

    function updateMaximumAmount(uint256 _maxValue) public onlyTally {
        maxAmount = _maxValue;
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
            RevenuePool(revenuePool).convertToSpend(token, amount);
        return (minAmount <= amountInSPEND && amountInSPEND <= maxAmount);
    }

    /**
     * @dev Split Prepaid card
     * @param depot Supplier address
     * @param token Token address
     * @param amountReceived Amount to split
     * @param amountOfCard array which performing face value of card
     */
    function createMultiplePrepaidCards(
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
            require(isValidAmount(token, amountOfCard[i]), "Amount invalid.");
            neededAmount = neededAmount.add(amountOfCard[i]);
        }

        // TODO: should we handle the case when amount received > needed amount
        //      (transfer the rest of token back to issuer) ?
        require(amountReceived == neededAmount, "Not enough token");

        for (uint256 i = 0; i < numberCard; i++) {
            createPrepaidCard(depot, token, amountOfCard[i]);
        }

        return true;
    }

    /**
     * @dev adapt getExecTransactionHash of gnosis safe
     * @param card Prepaid Card's address
     * @param to Destination address of Safe transaction
     * @param data Data payload of Safe transaction
     * @param nonce Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
     */
    function getTransactionHash(
        address payable card,
        address to,
        bytes memory data,
        uint256 nonce
    ) public view returns (bytes32) {
        return
            GnosisSafe(card).getTransactionHash(
                to,
                0,
                data,
                Enum.Operation.Call,
                0,
                0,
                0,
                address(0),
                address(0),
                nonce
            );
    }

    /**
     * @dev sell card for customer
     * @param prepaidCard Prepaid Card's address
     * @param depot depot issue card
     * @param customer Customer's address
     * @param issuerSignatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
     */
    function sellCard(
        address payable prepaidCard,
        address depot,
        address customer,
        bytes calldata issuerSignatures
    ) external payable returns (bool) {
        // Only sell 1 time
        require(
            cardDetails[prepaidCard].issuer == depot,
            "The card has been sold"
        );

        return
            execTransaction(
                prepaidCard,
                prepaidCard,
                getSellCardData(depot, customer),
                issuerSignatures
            );
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
     * @dev Returns the bytes that are hashed to be signed by owners
     * @param prepaidCard Prepaid Card's address
     * @param depot depot issue card
     * @param customer Customer's address
     * @param nonce Transaction nonce
     */
    function getSellCardHash(
        address payable prepaidCard,
        address depot,
        address customer,
        uint256 nonce
    ) public view returns (bytes32) {
        return
            getTransactionHash(
                prepaidCard,
                prepaidCard,
                getSellCardData(depot, customer),
                nonce
            );
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
     * @param merchant Merchant's address
     * @param amount value to pay to merchant
     * @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
     * TODO: should limit minimum price of merchant service. Attacker can spam our contract if price is to low.
     * TODO: relayer should check all information correctly before call this method
     */
    function payForMerchant(
        address payable prepaidCard,
        address payableTokenAddr,
        address merchant,
        uint256 amount,
        bytes calldata signatures
    ) external returns (bool) {
        return
            execTransaction(
                prepaidCard,
                payableTokenAddr,
                getPayData(payableTokenAddr, merchant, amount),
                signatures
            );
    }

    /**
     * @dev Returns the bytes that are hashed to be signed by owners.
     * @param token Token merchant
     * @param merchant Merchant's address
     * @param amount amount need pay to merchant
     */
    function getPayData(
        address token, // solhint-disable-line no-unused-vars
        address merchant,
        uint256 amount
    ) public view returns (bytes memory) {
        return
            abi.encodeWithSelector(
                TRANSER_AND_CALL,
                revenuePool,
                amount,
                abi.encode(merchant)
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
        (address depot, uint256[] memory cardAmounts) =
            abi.decode(data, (address, uint256[]));

        require(
            depot != address(0) && cardAmounts.length > 0,
            "Prepaid card data invalid"
        );

        createMultiplePrepaidCards(depot, _msgSender(), amount, cardAmounts);

        return true;
    }

    /**
     * @dev Get split card hash
     */
    function getSplitCardHash(
        address payable card,
        address depot,
        address token,
        uint256[] memory cardAmounts,
        uint256 _nonce
    ) public view returns (bytes32) {
        return
            getTransactionHash(
                card,
                token,
                getSplitCardData(depot, cardAmounts),
                _nonce
            );
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
     * @param depot Owner of card
     * @param issueToken Token's address
     * @param cardAmounts Array of new card's amount
     * @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
     */
    function splitCard(
        address payable prepaidCard,
        address depot,
        address issueToken,
        uint256[] calldata cardAmounts,
        bytes calldata signatures
    ) external payable returns (bool) {
        return
            execTransaction(
                prepaidCard,
                issueToken,
                getSplitCardData(depot, cardAmounts),
                signatures
            );
    }

    /**
     * @dev Create Prepaid card
     * @param depot depot address
     * @param token token address
     * @param amount amount of prepaid card
     * @return PrepaidCard address
     */
    function createPrepaidCard(
        address depot,
        address token,
        uint256 amount
    ) private returns (address) {
        address[] memory owners = new address[](2);

        owners[0] = address(this);
        owners[1] = depot;

        address card = createSafe(owners, 2);

        // card was created
        cardDetails[card].issuer = depot;
        cardDetails[card].issueToken = token;
        IERC677(token).transfer(card, amount);

        emit CreatePrepaidCard(depot, card, token, amount);

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
        bytes memory signatures
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
                address(0),
                address(0),
                signatures
            ),
            "safe transaction was reverted"
        );

        return true;
    }
}
