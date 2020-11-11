pragma solidity >=0.5.17;
import "@gnosis.pm/safe-contracts/contracts/base/Module.sol";
import "@gnosis.pm/safe-contracts/contracts/base/ModuleManager.sol";
import "@gnosis.pm/safe-contracts/contracts/base/OwnerManager.sol";
import "@gnosis.pm/safe-contracts/contracts/common/Enum.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract CardModule is Module {
    using SafeMath for uint256;
    string public constant NAME = "Card Module";
    string public constant VERSION = "0.1.0";
    address REVENUE_POOL_ADDRESS;
    address CARD_STACK_ADMIN_ADDRESS;
    address PREPAID_CARD_MANAGER_ADDRESS;
    bool sold;

    /**
     * @dev Setup function sets initial storage of contract.
     * @param revenuePoolAddress Revenue Pool Address
     * @param PrepaidCardManagerAddress Prepaid card manager Address
     * @param admin Admin address
     */
    function setup(
        address revenuePoolAddress,
        address PrepaidCardManagerAddress,
        address admin
    ) public {
        setManager();
        REVENUE_POOL_ADDRESS = revenuePoolAddress;
        CARD_STACK_ADMIN_ADDRESS = admin;
        PREPAID_CARD_MANAGER_ADDRESS = PrepaidCardManagerAddress;
    }

    modifier onlyOwner() {
        // Prevent Card stack admin use
        require(
            msg.sender != CARD_STACK_ADMIN_ADDRESS,
            "Card stack admin can not use"
        );
        // Only Safe owners are allowed to execute transactions.
        require(
            OwnerManager(address(manager)).isOwner(msg.sender),
            "Method can only be called by an owner"
        );
        _;
    }

    /**
     * @dev split the card to multible card
     * @param token Token address
     * @param number Number of card want to split
     * @param amountPerCard Amount per card
     * @return Returns if transaction can be executed.
     */
    function splitCard(
        address token,
        uint256 number,
        uint256 amountPerCard
    ) public onlyOwner {
        bytes memory data = abi.encodeWithSignature(
            "transferAndCall(address,uint256,bytes)",
            PREPAID_CARD_MANAGER_ADDRESS,
            number.mul(amountPerCard),
            abi.encodeWithSignature(
                "address,bytes",
                msg.sender,
                abi.encodeWithSignature(
                    "uint256,uint256",
                    number,
                    amountPerCard
                )
            )
        );
        require(
            manager.execTransactionFromModule(
                token,
                0,
                data,
                Enum.Operation.Call
            ),
            "Could not split the card"
        );
    }

    /**
     * @dev Sell to customer
     * @param to Address of new owner
     * @return Returns if transaction can be executed.
     */
    function sellCard(address to) public onlyOwner {
        // Only sell 1 time
        require(!sold, "The card has been sold before");

        // Swap owner
        // CARD_STACK_ADMIN_ADDRESS must be add before user address when crating card
        bytes memory data = abi.encodeWithSignature(
            "swapOwner(address,address,address)",
            CARD_STACK_ADMIN_ADDRESS,
            msg.sender,
            to
        );
        require(
            manager.execTransactionFromModule(
                address(manager),
                0,
                data,
                Enum.Operation.Call
            ),
            "Could not swap owner"
        );

        // The card has been sold
        sold = true;
    }

    /**
     * @dev Pay to merchant
     * @param token Address of the token that should be used to pay
     * @param to Address of merchant
     * @param amount Amount of tokens that should be pay to merchant
     * @return Returns if transaction can be executed.
     */
    function pay(
        address token,
        address to,
        uint256 amount
    ) public onlyOwner {
        bytes memory data = abi.encodeWithSignature(
            "transferAndCall(address,uint256,bytes)",
            REVENUE_POOL_ADDRESS,
            amount,
            abi.encode(to)
        );
        require(
            manager.execTransactionFromModule(
                token,
                0,
                data,
                Enum.Operation.Call
            ),
            "Could not pay to merchant"
        );
    }
}
