pragma solidity ^0.5.0;


interface IRevenuePool {
    
    function registerMerchant(string calldata name) external returns(bool);

    // function registerServiceOrProduct(uint productId, uint price) external returns(bool);

    function pay(address merchantId, uint amount) external returns(bool);

    function redeemRevenue() external returns(bool);
}