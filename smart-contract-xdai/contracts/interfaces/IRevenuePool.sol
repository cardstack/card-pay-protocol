pragma solidity 0.5.17;

interface IRevenuePool {
    event Claim(address merchantAddr, address payableToken, uint256 amount);

    event Payment(
        address prepaidCardArr,
        address merchantAddr,
        address payableToken,
        uint256 amount
    );

    /**
     * @dev onTokenTransfer(ERC677) - call when token receive pool.
     * we will exchange receive token to SPEND token and mint it for the wallet of merchant.
     * @param from - who transfer token (should from prepaid card).
     * @param amount - number token customer pay for merchant.
     * @param data - merchantAddr in encode format.
     */
    function onTokenTransfer(
        address from,
        uint256 amount,
        bytes calldata data
    ) external returns (bool);

    /**
     * @dev merchant claim token to their wallets, only tally account can call this method
     * @param merchantAddr address of merchant
     * @param payableTokens array address of payable token
     * @param amounts array amount in payable token
     */
    function claimTokens(
        address merchantAddr,
        address[] calldata payableTokens,
        uint256[] calldata amounts
    ) external returns (bool);
}
