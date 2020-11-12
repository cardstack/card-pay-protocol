pragma solidity >=0.5.17;

import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/libraries/CreateAndAddModules.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

//modules
import "./modules/CardModule.sol";

import "./token/IERC677.sol";
import "./roles/Tally.sol";
import "./roles/PayableToken.sol";

contract PrepaidCardManager is Tally, PayableToken {
    using SafeMath for uint256;

    event CreatePrepaidCard(
        address supplier,
        address card,
        address token,
        uint256 amount
    );
    event SplitCard(
        address supplier,
        address card,
        address token,
        uint256 number,
        uint256 amount,
        address[] list
    );

    address private gsMasterCopy;
    address private gsProxyFactory;
    address private gsCreateAndAddModules;
    address private revenuePool;
    address private cardModule;

    mapping(address => bool) cards;

    /**
     * @dev Setup function sets initial storage of contract.
     * @param _tally Tally address
     * @param _gsMasterCopy Gnosis safe Master Copy address
     * @param _gsProxyFactory Gnosis safe Proxy Factory address
     * @param _gsCreateAndAddModules Gnosis safe CreateAndAddModules address
     * @param _revenuePool Revenue Pool address
     * @param _cardModule Card Module address
     * @param _payableTokens Payable tokens are allowed to use
     */
    function setup(
        address _tally,
        address _gsMasterCopy,
        address _gsProxyFactory,
        address _gsCreateAndAddModules,
        address _revenuePool,
        address _cardModule,
        address[] memory _payableTokens
    ) public onlyOwner {
        // setup tally user
        addTally(_tally);
        gsMasterCopy = _gsMasterCopy;
        gsProxyFactory = _gsProxyFactory;
        gsCreateAndAddModules = _gsCreateAndAddModules;
        revenuePool = _revenuePool;
        cardModule = _cardModule;

        // set token list payable.
        for (uint256 i = 0; i < _payableTokens.length; ++i) {
            addPayableToken(_payableTokens[i]);
        }
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
        owners[0] = owner();
        owners[1] = supplier;

        bytes memory moduleDataPayloads = abi.encodeWithSignature(
            "setup(address,address,address)",
            revenuePool,
            this,
            owners[0]
        );
        bytes memory proxyFactoryDataPayloads = abi.encodeWithSignature(
            "createProxy(address,bytes)",
            cardModule,
            moduleDataPayloads
        );

        bytes memory moduleDataWrapper = abi.encodeWithSignature(
            "setup(bytes)",
            proxyFactoryDataPayloads
        );
        bytes memory modulesCreationDataPayloads = new bytes(
            moduleDataWrapper.length - 36
        );
        for (uint256 i = 0; i < modulesCreationDataPayloads.length; i++) {
            modulesCreationDataPayloads[i] = moduleDataWrapper[i.add(36)];
        }
        bytes memory createAndAddModulesDataPayloads = abi.encodeWithSignature(
            "createAndAddModules(address,bytes)",
            gsProxyFactory,
            modulesCreationDataPayloads
        );
        bytes memory payloads = abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            2,
            gsCreateAndAddModules,
            createAndAddModulesDataPayloads,
            address(0),
            address(0),
            0,
            address(0)
        );

        address card = address(
            GnosisSafeProxyFactory(gsProxyFactory).createProxy(
                gsMasterCopy,
                payloads
            )
        );

        require(card != address(0), "Could not create card");

        require(IERC677(token).transfer(card, amount));

        emit CreatePrepaidCard(supplier, card, token, amount);

        // card was created
        cards[card] = true;

        return card;
    }

    /**
     * @dev Split Prepaid card
     * @param supplier Supplier address
     * @param card Prepaid card address
     * @param token Token address
     * @param amount Amount to split
     * @param payloads Payloads
     */
    function _split(
        address supplier,
        address card,
        address token,
        uint256 amount,
        bytes memory payloads
    ) private returns (address[] memory) {
        uint256 number;
        uint256 amountPerCard;

        (number, amountPerCard) = abi.decode(payloads, (uint256, uint256));

        require(number > 0, "number of card must be greater than 0");
        require(amountPerCard > 0, "amount per card must be greater than 0");
        require(
            amount >= number.mul(amountPerCard),
            "your amount must be >= (number of card) * (amount per card)"
        );

        address[] memory list = new address[](number);
        address newCard;
        for (uint256 p = 0; p < number; p++) {
            newCard = _createPrepaidCard(supplier, token, amountPerCard);
            list[p] = newCard;
        }

        emit SplitCard(supplier, card, token, number, amountPerCard, list);

        return list;
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

        if (cards[from] && supplier != address(0)) {
            _split(supplier, from, _msgSender(), amount, payloads);
        } else {
            _createPrepaidCard(from, _msgSender(), amount);
        }
        return true;
    }
}
