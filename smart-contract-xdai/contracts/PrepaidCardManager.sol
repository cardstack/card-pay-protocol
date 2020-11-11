pragma solidity >=0.5.17;

import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/libraries/CreateAndAddModules.sol";
import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

//BytesLib https://github.com/GNSPS/solidity-bytes-utils
import "solidity-bytes-utils/contracts/BytesLib.sol";

//modules
import "./modules/CardModule.sol";

import "./token/IERC677.sol";
import "./roles/Tally.sol";
import "./roles/PayableToken.sol";

contract PrepaidCardManage is Tally, PayableToken {
    using BytesLib for bytes;
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

    using SafeMath for uint256;

    address private gsMasterCopy;
    address private gsProxyFactory;
    address private gsCreateAndAddModules;
    address private revenuePool;
    address private cardModule;

    function setup(
        address _tally,
        address[] memory _gnosisSafe,
        address[] memory _payableTokens
    ) public onlyOwner {
        // setup tally user
        addTally(_tally);
        /**
        setup gnosis safe address
        _gnosisSafe[0] is masterCopy address
        _gnosisSafe[1] is gnosis proxy factory address
        _gnosisSafe[2] is gnosis CreateAndAddModules 
        _gnosisSafe[3] is revenuePool address
        _gnosisSafe[3] is cardModule address
        */
        gsMasterCopy = _gnosisSafe[0];
        gsProxyFactory = _gnosisSafe[1];
        gsCreateAndAddModules = _gnosisSafe[2];
        revenuePool = _gnosisSafe[3];
        cardModule = _gnosisSafe[4];

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
        bytes memory modulesCreationDataPayloads = proxyFactoryDataPayloads
            .slice(72, proxyFactoryDataPayloads.length.add(72));
        bytes memory createAndAddModulesDataPayloads = abi.encodeWithSignature(
            "createAndAddModules(address,bytes)",
            gsProxyFactory,
            modulesCreationDataPayloads
        );
        bytes memory payloads = abi.encodeWithSignature(
            "setup(address[],uint256,address,bytes,address,address,uint256,address)",
            owners,
            2,
            address(0),
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

        require(
            IERC677(token).transfer(card, amount),
            "Could not transfer token to card"
        );

        emit CreatePrepaidCard(supplier, card, token, amount);

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
            require(newCard != address(0));
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
        address supplier;
        bytes memory payloads;
        (supplier, payloads) = abi.decode(data, (address, bytes));

        if (supplier != address(0)) {
            _split(supplier, from, _msgSender(), amount, payloads);
        } else {
            require(
                _createPrepaidCard(from, _msgSender(), amount) != address(0)
            );
        }
        return true;
    }
}
