pragma solidity ^0.5.17;


interface IRevenuePool {
    
    function registerMerchant(address merchantAddr, string calldata merchantId) external returns(bool);

    // function registerServiceOrProduct(uint productId, uint price) external returns(bool);

    function pay(address merchantId, uint amount) external returns(bool);

    function redeemRevenue() external returns(bool);
}