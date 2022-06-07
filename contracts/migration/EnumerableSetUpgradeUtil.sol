pragma solidity ^0.8.9;

contract EnumerableSetUpgradeUtil {
  // Store a bool in this slot to indicate if upgrade is complete or not

  // bytes32(uint256(keccak256("cardstack.upgraded.gnosis-1-3")) - 1)
  bytes32 internal constant UPGRADE_SLOT =
    0x0b1bb611f79d610ce486931d9d82ba0af2f593da3a1bbc64de519121a192be5c;

  // * This is the keccak-256 hash of "eip1967.proxy.admin" subtracted by 1, and is
  // * validated in the constructor.

  bytes32 internal constant ADMIN_SLOT =
    0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

  uint256 internal constant OWNER_SLOT = 51;

  struct OldAddressSet {
    // Position of the value in the `values` array, plus 1 because index 0
    // means a value is not in the set.
    mapping(address => uint256) index;
    address[] values;
  }

  modifier upgrader() {
    require(
      owner() == msg.sender || admin() == msg.sender,
      "Only owner or proxy admin can call"
    );
    require(!isUpgraded(), "Upgrade has already completed");
    _;
  }

  function isUpgraded() public view returns (bool upgraded) {
    assembly {
      upgraded := sload(UPGRADE_SLOT)
    }
  }

  function owner() public view virtual returns (address _owner) {
    assembly {
      _owner := sload(OWNER_SLOT)
    }
  }

  function admin() public view returns (address _admin) {
    assembly {
      _admin := sload(ADMIN_SLOT)
    }
  }

  function upgrade() external virtual upgrader {
    _upgradeFinished();
  }

  function readOldAddressSet(bytes32 slot)
    public
    view
    returns (address[] memory)
  {
    OldAddressSet storage set;
    assembly {
      set.slot := slot
    }

    address[] memory output = new address[](set.values.length);
    for (uint256 i; i < set.values.length; i++) {
      output[i] = set.values[i];
    }
    return output;
  }

  struct NewSet {
    // Storage of set values
    bytes32[] _values;
    // Position of the value in the `values` array, plus 1 because index 0
    // means a value is not in the set.
    mapping(bytes32 => uint256) _indexes;
  }

  struct NewAddressSet {
    NewSet _inner;
  }

  function readNewAddressSet(bytes32 slot)
    external
    view
    returns (address[] memory)
  {
    NewAddressSet storage set;
    assembly {
      set.slot := slot
    }

    return values(set);
  }

  function newSetContains(bytes32 slot, address value)
    external
    view
    returns (bool)
  {
    NewAddressSet storage set;
    assembly {
      set.slot := slot
    }

    return _contains(set._inner, bytes32(uint256(uint160(value))));
  }

  function upgradeEnumerableAddressSet(bytes32 slot) external upgrader {
    _upgradeEnumerableAddressSet(slot);
  }

  function _upgradeFinished() internal {
    assembly {
      sstore(UPGRADE_SLOT, true)
    }
  }

  function _upgradeEnumerableAddressSet(bytes32 slot) internal {
    NewAddressSet storage addressSet;
    assembly {
      addressSet.slot := slot
    }

    address[] memory addresses = readOldAddressSet(slot);

    for (uint256 i = 0; i < addresses.length; i++) {
      _add(addressSet._inner, bytes32(uint256(uint160(addresses[i]))));
    }
  }

  // Functions for manipulating upgraded sets - largely copypasted from OZ
  function values(NewAddressSet storage set)
    internal
    view
    returns (address[] memory)
  {
    bytes32[] memory store = _values(set._inner);
    address[] memory result;

    assembly {
      result := store
    }

    return result;
  }

  function _values(NewSet storage set) private view returns (bytes32[] memory) {
    return set._values;
  }

  function remove(NewAddressSet storage set, address value)
    internal
    returns (bool)
  {
    return _remove(set._inner, bytes32(uint256(uint160(value))));
  }

  function _remove(NewSet storage set, bytes32 value) private returns (bool) {
    // We read and store the value's index to prevent multiple reads from the same storage slot
    uint256 valueIndex = set._indexes[value];

    if (valueIndex != 0) {
      // Equivalent to contains(set, value)
      // To delete an element from the _values array in O(1), we swap the element to delete with the last one in
      // the array, and then remove the last element (sometimes called as 'swap and pop').
      // This modifies the order of the array, as noted in {at}.

      uint256 toDeleteIndex = valueIndex - 1;
      uint256 lastIndex = set._values.length - 1;

      if (lastIndex != toDeleteIndex) {
        bytes32 lastvalue = set._values[lastIndex];

        // Move the last value to the index where the value to delete is
        set._values[toDeleteIndex] = lastvalue;
        // Update the index for the moved value
        set._indexes[lastvalue] = valueIndex; // Replace lastvalue's index to valueIndex
      }

      // Delete the slot where the moved value was stored
      set._values.pop();

      // Delete the index for the deleted slot
      delete set._indexes[value];

      return true;
    } else {
      return false;
    }
  }

  function add(NewAddressSet storage set, address value)
    internal
    returns (bool)
  {
    return _add(set._inner, bytes32(uint256(uint160(value))));
  }

  function _add(NewSet storage set, bytes32 value) private returns (bool) {
    if (!_contains(set, value)) {
      set._values.push(value);
      // The value is stored at length-1, but we add 1 to all indexes
      // and use 0 as a sentinel value
      set._indexes[value] = set._values.length;
      return true;
    } else {
      return false;
    }
  }

  function _contains(NewSet storage set, bytes32 value)
    private
    view
    returns (bool)
  {
    return set._indexes[value] != 0;
  }

  function _addressSetValueSlot(uint256 setSlot, bytes32 key)
    public
    pure
    returns (bytes32)
  {
    return bytes32(keccak256(abi.encode(key, bytes32(setSlot))));
  }

  function _addressSetValueSlot(uint256 setSlot, address key)
    public
    pure
    returns (bytes32)
  {
    return _addressSetValueSlot(setSlot, bytes32(uint256(uint160(key))));
  }
}
