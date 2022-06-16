pragma solidity ^0.8.9;
pragma abicoder v1;

interface IProxyAdmin {
  function getProxyAdmin(address proxy) external view returns (address);

  function getProxyImplementation(address proxy)
    external
    view
    returns (address);

  function upgrade(address proxy, address implementation) external;

  function upgradeAndCall(
    address proxy,
    address implementation,
    bytes memory data
  ) external payable;

  // inherited from Ownable
  function owner() external view returns (address);

  function transferOwnership(address newOwner) external;

  function renounceOwnership() external;
}
