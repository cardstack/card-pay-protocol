pragma solidity 0.5.17;

interface IPrepaidCardManager {
    function onTokenTransfer(
        address from,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);

    function payForMerchant(
        address payable card,
        address payableTokenAddr,
        address merchant,
        uint256 payment,
        bytes calldata signatures
    ) external returns (bool);

    function sellCard(
        address payable card,
        address from,
        address to,
        bytes calldata signatures
    ) external payable returns (bool);

    function splitCard(
        address payable card,
        address from,
        address token,
        uint256[] calldata cardAmounts,
        bytes calldata signatures
    ) external payable returns(bool);
}
