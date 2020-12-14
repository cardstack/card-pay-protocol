const assert = require('assert');
const AbiCoder = require('web3-eth-abi');

const {
    toBN
} = require('web3-utils');

const {
    signSafeTransaction
} = require('./general')

class TokenHelper {

    constructor() {
        this.decimals = 0;
    }

    static async deploy({
        TokenABIs,
        args
    }) {
        let instance = await TokenABIs.new(...args);
        return instance;
    }

    static async isEqualBalance(token, address, amount) {
        return assert.strictEqual((await token.balanceOf(address)).toString(), amount.toString());
    }

    async setUp({
        contractToken
    }) {
        this.decimals = await contractToken.decimals();
    }

    /**
     * Convert from number token to token base unit.
     * @param {number} _numberToken number token 
     * @return token base unit of number token.
     */
    amountOf(_numberToken) {
        return TokenHelper.amountOf(_numberToken, this.decimals);
    }


  static  async   getBalance(token, account) 
   {  
        let currentBalance =  await token.balanceOf(account); 
       
        return  toBN(currentBalance).toString();
    }
 

    static amountOf(_numberToken, _decimals = 16) {
        let dec = toBN("10").pow(toBN(_decimals));
        let number = toBN(_numberToken);
        return number.mul(dec).toString();
    }

    async isEqualBalance(account, amount) {
        let currentBanlance = await this.instance.balanceOf(account);
        return toBN(currentBanlance).toString() === toBN(amount).toString();
    }
}

ContractHelper = {
    prepageDataForCreateMutipleToken(account, amounts = []) {
        return AbiCoder.encodeParameters(
            ["address", "uint256[]"],
            [
                account,
                amounts
            ]
        )
    },


    async signAndSendSafeTransactionByRelayer(
        safeTxData = {
            to,
            value,
            data,
            operation,
            txGasEstimate,
            baseGasEstimate,
            gasPrice,
            txGasToken,
            refundReceiver
        },
        owner,
        gnosisSafe,
        relayer
    ) {
        let safeTxArr = Object.keys(safeTxData).map(key => safeTxData[key])

        let nonce = await gnosisSafe.nonce();
        // sign data with nonce by owner and gnosisSafe
        let signature = await signSafeTransaction(...safeTxArr, nonce, owner, gnosisSafe);

        // compute txHash of transaction
        let safeTxHash = await gnosisSafe.getTransactionHash(...safeTxArr, nonce);

        // send transaction to network
        let safeTx = await gnosisSafe.execTransaction(...safeTxArr, signature, {
            from: relayer
        });

        return {
            safeTxHash,
            safeTx
        };
    }
}



module.exports = {
    TokenHelper,
    ContractHelper
}
