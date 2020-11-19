pragma solidity ^0.5.17;

interface IRevenuePool {
    // ERC677 receipt token inferface
    function onTokenTransfer(
        address from,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);

    function redeemRevenue(
        address merchantAddr,
        uint256 walletIndex,
        address[] calldata payableTokens,
        uint256[] calldata amounts
    ) external returns (bool);
}
