pragma solidity >=0.5.0 <0.7.0;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxy.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/common/SignatureDecoder.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./token/IERC677.sol";
import "./roles/TallyRole.sol";
import "./roles/PayableToken.sol";


contract PrepaidCardManager is TallyRole, PayableToken, SignatureDecoder {
    
    //setup(address[],uint256,address,bytes,address,address,uint256,address)
    bytes4 public constant SET_UP = 0xb63e800d;
    //swapOwner(address,address,address)
    bytes4 public constant SWAP_OWNER = 0xe318b52b;
    //"execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)"   // use uint8 <=> Enum.operation
    bytes4 public constant EXEC_TRANSACTION = 0x6a761202;

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
    
    mapping(address => address) suppliers;

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
        address _tokenManager,
        address[] memory _payableTokens
    ) public onlyOwner {
        // setup tally user
        addTally(_tally);
        gsMasterCopy = _gsMasterCopy;
        gsProxyFactory = _gsProxyFactory;
        revenuePool = _revenuePool;
        
        PayableToken(_tokenManager);
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
    function _createPrepaidCard(
        address supplier,
        address token,
        uint256 amount
    ) private returns (address) {
        address[] memory owners = new address[](2);
        owners[0] = address(this);
        owners[1] = supplier;

        bytes memory payloads = abi.encodeWithSelector(
            SET_UP,
            owners,
            2,
            address(0),
            "0x",
            address(0),
            address(0),
            0,
            address(0)
        );

        address payable card = address(
            GnosisSafeProxyFactory(gsProxyFactory).createProxy(
                gsMasterCopy,
                payloads
            )
        );

        require(card != address(0), "Could not create card");

        require(IERC677(token).transfer(card, amount));

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
     * @param payloads Payloads
     */
    function _createMultiplePrepaidCards(
        address supplier,
        address token,
        uint256 amountReceived,
        bytes memory payloads
    ) private returns (bool) {
        uint256[] memory cardAmounts = abi.decode(payloads, (uint256[]));

        require(
            cardAmounts.length > 0,
            "number of card must be greater than 0"
        );

        uint256 neededAmount = 0;

        for (uint256 i = 0; i < cardAmounts.length; i++) {
            neededAmount = neededAmount.add(cardAmounts[i]);
        }

        // TODO: should we handle the case when amount received > needed amount
        //      (transfer the rest of token back to supplier) ?
        require(
            amountReceived == neededAmount,
            "your amount must be == sum of new cardAmounts"
        );

        for (uint256 i = 0; i < cardAmounts.length; i++) {
            _createPrepaidCard(supplier, token, cardAmounts[i]);
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
    function _execTransaction(
        address payable card,
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
            address(0),
            address(0),
            signatures
        );

        (bool success, ) = card.call(payloads);

        require(success);

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
        require(
            _execTransaction(
                card,
                card,
                getSellCardData(card, from, to),
                signatures
            )
        );
    }

    /**
     * @dev Returns the bytes that are hashed to be signed by owners
     * @param card Prepaid Card's address
     * @param from Ower of card
     * @param to Customer's address
     */
    function getSellCardData(
        address payable card,
        address from,
        address to
    ) public view returns (bytes memory) {
        // Only sell 1 time
        require(suppliers[card] == from, "The card has been sold before");

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
     * @param _nonce Transaction nonce
     */
    function getSellCardHash(
        address payable card,
        address from,
        address to,
        uint256 _nonce
    ) public view returns (bytes32) {
        return
            GnosisSafe(card).getTransactionHash(
                card,
                0,
                getSellCardData(card, from, to),
                Enum.Operation.Call,
                0,
                0,
                0,
                address(0),
                address(0),
                _nonce
            );
    }

    /**
     * Contract Signature
     * signature type == 1
     * s = ignored
     * r = contract address with padding to 32 bytes
     * {32-bytes r}{32-bytes s}{1-byte signature type}
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
     * @dev onTokenTransfer(ERC677) - call when token send this contract.
     * @param from Supplier or Prepaid card address
     * @param amount number token them pay.
     * @param data data encoded
     */
    function onTokenTransfer(
        address from,
        uint256 amount,
        bytes calldata data
    ) external onlyPayableToken() returns (bool) {
        address supplier = address(0);
        bytes memory payloads;

        if (data.length > 2) {
            (supplier, payloads) = abi.decode(data, (address, bytes));
        }

        require(supplier != address(0), "Missing card owner's address");

        if (payloads.length > 0) {
            require(
                _createMultiplePrepaidCards(
                    supplier,
                    _msgSender(),
                    amount,
                    payloads
                )
            );
        } else {
            require(
                _createPrepaidCard(supplier, _msgSender(), amount) != address(0)
            );
        }
        return true;
    }
}
