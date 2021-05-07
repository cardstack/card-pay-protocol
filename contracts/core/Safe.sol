pragma solidity 0.5.17;

import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";

contract Safe {
  bytes4 internal constant SETUP = 0xb63e800d;
  address internal constant ZERO_ADDRESS = address(0);

  address public gnosisSafe;
  address public gnosisProxyFactory;

  function setup(address _gnosisSafe, address _gnosisProxyFactory) internal {
    gnosisProxyFactory = _gnosisProxyFactory;
    gnosisSafe = _gnosisSafe;
  }

  function createSafe(address[] memory safeOwners, uint256 threshold)
    internal
    returns (address)
  {
    bytes memory data =
      abi.encodeWithSelector(
        SETUP,
        safeOwners,
        threshold,
        ZERO_ADDRESS,
        "",
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        0,
        ZERO_ADDRESS
      );

    address safe =
      address(
        GnosisSafeProxyFactory(gnosisProxyFactory).createProxy(gnosisSafe, data)
      );

    require(safe != ZERO_ADDRESS, "Create a Safe failed");

    return safe;
  }

  function createSafe(address owner) internal returns (address) {
    address[] memory ownerArr = new address[](1);
    ownerArr[0] = owner;

    return createSafe(ownerArr, 1);
  }

  uint256[50] private ____gap;
}
