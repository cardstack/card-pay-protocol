pragma solidity ^0.8.9;
pragma abicoder v1;

interface IAdminUpgradeabilityProxy {
  event Upgraded(address indexed implementation);
}
