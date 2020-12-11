pragma solidity >=0.5.0 <0.7.0;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./token/IERC677.sol";
import "./roles/TallyRole.sol";
import "./roles/PayableToken.sol";
import "./core/Executor.sol";
import "./core/Safe.sol";


contract PrepaidCardManager is TallyRole, PayableToken, SimpleExecutor, Safe{
    
    //swapOwner(address,address,address)
    bytes4 public constant SWAP_OWNER = 0xe318b52b;
    //execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)   // use uint8 <=> Enum.operation
    bytes4 public constant EXEC_TRANSACTION = 0x6a761202;
    //transferAndCall(address,uint256,bytes) 
    bytes4 public constant TRANSER_AND_CALL = 0x4000aea0;

    using SafeMath for uint256;

    event CreatePrepaidCard(
        address supplier,
        address card,
        address token,
        uint256 amount
    );
    

    address public gsMasterCopy;
    address public gsProxyFactory;
    address public gsCreateAndAddModules;
    address public revenuePool;
    
    mapping(address => address) public suppliers;

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
        address[] memory _payableTokens
    ) public onlyOwner {
        // setup tally user
        addTally(_tally);
        
        revenuePool = _revenuePool;

        Safe.setup(_gsMasterCopy, _gsProxyFactory);
        // set token list payable.
        for (uint256 i = 0; i < _payableTokens.length; i++) {
            addPayableToken(_payableTokens[i]);
        }
    }

    /**
     * @dev Add new payable token
     * @param _token Token address
     */
    function addPayableTokenByTally(address _token)
        public
        onlyTally
        returns (bool)
    {
        return _addPayableToken(_token);
    }

    /**
     * @dev Create Prepaid card
     * @param supplier Supplier address
     * @param token Token address
     * @param amount Amount of Prepaid card
     * @return PrepaidCard address
     */
    function createPrepaidCard(
        address supplier,
        address token,
        uint256 amount
    ) private returns (address) {
        address[] memory owners = new address[](2);
        owners[0] = address(this);
        owners[1] = supplier;

        address card = createSafe(owners, 2); 

        IERC677(token).transfer(card, amount);

        emit CreatePrepaidCard(supplier, card, token, amount);

        // card was created
        suppliers[card] = supplier;

        return card;
    }

    /**
     * @dev Split Prepaid card
     * @param supplier Supplier address
     * @param token Token address
     * @param amountReceived Amount to split
     * @param amountOfCard array which performing face value of card
     */
    function createMultiplePrepaidCards(
        address supplier,
        address token,
        uint256 amountReceived,
        uint256[] memory amountOfCard
    ) private returns (bool) {
        uint256 neededAmount = 0;
        uint256 numberCard = amountOfCard.length; 

        for (uint256 i = 0; i < numberCard; i++) {
            neededAmount = neededAmount.add(amountOfCard[i]);
        }

        // TODO: should we handle the case when amount received > needed amount
        //      (transfer the rest of token back to supplier) ?
        require(
            amountReceived == neededAmount,
            "your amount must be == sum of new cardAmounts"
        );

        for (uint256 i = 0; i < numberCard; i++) {
            createPrepaidCard(supplier, token, amountOfCard[i]);
        }

        return true;
    }

    /**
     * @dev Exec Prepaid Card
     * @param card Prepaid Card's address
     * @param to Destination address of Safe transaction
     * @param data Data payload of Safe transaction
     * @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
     */
    function execTransaction(
        address card,
        address to,
        bytes memory data,
        bytes memory signatures
    ) private returns (bool) {

        bytes memory payloads = abi.encodeWithSelector(
            EXEC_TRANSACTION, 
            to,
            0,
            data,
            Enum.Operation.Call,
            0,
            0,
            0,
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            signatures
        );

        // should limit this gas or not ? 
        require(executeCall(card, 0, payloads, gasleft()));

        return true;
    }

    /**
     * @dev Sell Card
     * @param card Prepaid Card's address
     * @param from Ower of card
     * @param to Customer's address
     * @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
     */
    function sellCard(
        address payable card,
        address from,
        address to,
        bytes calldata signatures
    ) external payable {
        // Only sell 1 time
        require(suppliers[card] == from, "The card has been sold before");

        execTransaction(
            card,
            card,
            getSellCardData(from, to),
            signatures
        );
    }

    /**
     * @dev Returns the bytes that are hashed to be signed by owners
     * @param from Ower of card
     * @param to Customer's address
     */
    function getSellCardData(
        address from,
        address to
    ) public view returns (bytes memory) {
        // Swap owner
        return
            abi.encodeWithSelector(
                SWAP_OWNER,
                address(this),
                from,
                to
            );
    }

    /**
     * @dev Returns the bytes that are hashed to be signed by owners
     * @param card Prepaid Card's address
     * @param from Ower of card
     * @param to Customer's address
     * @param nonce Transaction nonce
     */
    function getSellCardHash(
        address payable card,
        address from,
        address to,
        uint256 nonce
    ) public view returns (bytes32) {
        return
            GnosisSafe(card).getTransactionHash(
                card,
                0,
                getSellCardData(from, to),
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
     * @param card Prepaid Card's address
     * @param payableTokenAddr payable token address 
     * @param merchant Merchant's address
     * @param index index of Meschant'a wallet
     * @param payment value to pay to merchant
     * @param signatures Packed signature data ({bytes32 r}{bytes32 s}{uint8 v})
     * TODO: should limit minimum price of merchant service. Attacker can spam our contract if price is to low. 
     * TODO: relayer should check all information correctly before call this method
     */
    function payForMerchant(
        address payable card,
        address payableTokenAddr,
        address merchant,
        uint256 index,
        uint256 payment,
        bytes calldata signatures
    ) external payable returns(bool) 
    {
        execTransaction(
            card,
            payableTokenAddr,
            getPayData(payableTokenAddr, merchant, index, payment),
            signatures
        );
        return true;
    }

    /**
     * @dev Returns the bytes that are hashed to be signed by owners.
     * @param token Token's address
     * @param to Merchant's address
     * @param index index of Meschant'a wallet
     * @param value value to pay to merchant
     */
    function getPayData(
        address token,
        address to,
        uint256 index,
        uint256 value
    ) public view returns (bytes memory) {
        return
            abi.encodeWithSelector(
                TRANSER_AND_CALL,
                revenuePool,
                value,
                abi.encode(to, index)
            );
    }


    /**
     * @dev onTokenTransfer(ERC677) - call when token send this contract.
     * @param from Supplier or Prepaid card address
     * @param amount number token them pay.
     * @param data data encoded
     */
    function onTokenTransfer(
        address from,
        uint256 amount,
        bytes calldata data
    ) external onlyPayableToken returns (bool) {
        address supplier;
        uint256[] memory amountOfCard;

        (supplier, amountOfCard) = abi.decode(data, (address, uint256[]));

        require(supplier != address(0) && amountOfCard.length > 0, "Prepaid card data invalid");

        require(
            createMultiplePrepaidCards(
                supplier,
                _msgSender(),
                amount,
                amountOfCard
            )
        );
        
        return true;
    }

}
