const assert = require('assert');
const AbiCoder = require('web3-eth-abi');

const {
    toBN
} = require('web3-utils');


class TokenHelper {

    constructor() {
        this.decimals = 0;
    }

    static async deploy({
        TokenABIs,
        args
    }) {
        let tokenHelper = new TokenHelper();
        let instance = await TokenABIs.new(...args);
        tokenHelper.setUp({
            contractToken: instance
        });
        return instance;
    }

    static async isEqualBalance(token, address, amount) {
        return assert.strictEqual((await token.balanceOf(address)).toString(), amount.toString());
    }
    
    async setUp({
        contractToken
    }) {
        this.instance = contractToken;
        this.decimals = await this.instance.decimals();
    }

    async load({
        TokenABIs,
        address
    }) {
        console.log("Hello")
        this.instance = await TokenABIs.at(address);
        this.decimals = await this.instance.decimals();
    }

    // toAmount(_number) {
    //     return TokenHelper.toAmount(_number, this.decimals);
    // }

    static toAmount(_number, _decimals) {
        let dec = toBN("10").pow(toBN(_decimals));
        let number = toBN(_number);
        return number.mul(dec);
    }

    async methodABI(methodName, args = {}) {
        return await this.instance.contract.methods[methodName](...args).encodeABI();
    }

    getAddress() {
        return this.instance.address;
    }

    getInstance() {
        return this.instance;
    }

    async isEqualBalance(account, amount) {
        let currentBanlance = await this.instance.balanceOf(account);
        return currentBanlance.toString() === toBN(amount).toString();
    }
}

class ContractHelper {
    static prepageDataForCreateMutipleToken(account, amounts = []) {
        return AbiCoder.encodeParameters(
            ["address", "bytes"], 
            [
                account, 
                AbiCoder.encodeParameter("uint256[]", amounts)
            ]
        )
    }
}

module.exports = {
    TokenHelper, 
    ContractHelper
}