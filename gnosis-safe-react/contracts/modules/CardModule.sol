pragma solidity >=0.5.0 <0.7.0;
import '../base/Module.sol';
import '../base/ModuleManager.sol';
import '../base/OwnerManager.sol';
import '../common/Enum.sol';

contract CardModule is Module {
  string public constant NAME = 'Whitelist Module';
  string public constant VERSION = '0.1.0';
  address public REVENUE_POOL_ADDRESS;
  address public CARD_STACK_ADMIN_ADDRESS;

  /// @dev Setup function sets initial storage of contract.
  /// @param revenuePoolAddress Revenue Pool Address
  function setup(address revenuePoolAddress, address admin) public {
    setManager();
    REVENUE_POOL_ADDRESS = revenuePoolAddress;
    CARD_STACK_ADMIN_ADDRESS = admin;
  }

  /// @dev Returns if Safe transaction is to a whitelisted destination.
  /// @param token Address of the token that should be used to pay
  /// @param to Address of merchant
  /// @param amount Amount of tokens that should be pay to merchant
  /// @return Returns if transaction can be executed.
  function pay(
    address token,
    address to,
    uint256 amount
  ) public returns (bool) {
    // Prevent Card stack admin use
    require(msg.sender != CARD_STACK_ADMIN_ADDRESS, 'Card stack admin can not use');
    // Only Safe owners are allowed to execute transactions to whitelisted accounts.
    require(OwnerManager(address(manager)).isOwner(msg.sender), 'Method can only be called by an owner');
    bytes memory data = abi.encodeWithSignature(
      'transferAndCall(address,uint256,bytes)',
      REVENUE_POOL_ADDRESS,
      amount,
      abi.encode(to)
    );
    require(manager.execTransactionFromModule(token, 0, data, Enum.Operation.Call), 'Could not pay to merchant');
  }
}
