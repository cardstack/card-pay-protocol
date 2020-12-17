const assert = require('assert');
const AbiCoder = require('web3-eth-abi');

const {
    toBN
} = require('web3-utils');

const {
    signSafeTransaction
} = require('./general')

TokenHelper = {

    async deploy({
        TokenABIs,
        args
    }) {
        let instance = await TokenABIs.new(...args);
        return instance;
    },

    async isEqualBalance(token, address, amount) {
        return assert.strictEqual((await token.balanceOf(address)).toString(), amount.toString());
    },

    amountOf(_numberToken, _decimals = 18) {
        let dec = toBN("10").pow(toBN(_decimals));
        let number = toBN(_numberToken);
        return number.mul(dec).toString();
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
    
    preparePayment(merchant, walletIndex) {
        return AbiCoder.encodeParameters(
            [
                "address","uint256"
            ], 
            [
                merchant, walletIndex
            ])
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
        relayer,
        options = null,
    ) {
        let safeTxArr = Object.keys(safeTxData).map(key => safeTxData[key])

        let nonce = await gnosisSafe.nonce();
        // sign data with nonce by owner and gnosisSafe
        let signature = await signSafeTransaction(...safeTxArr, nonce, owner, gnosisSafe);

        // compute txHash of transaction
        let safeTxHash = await gnosisSafe.getTransactionHash(...safeTxArr, nonce);
        let safeTx;
        if (!options) {
            safeTx = await gnosisSafe.execTransaction(...safeTxArr, signature, {
                from: relayer, 
            });
        } else {
            safeTx = await gnosisSafe.execTransaction(...safeTxArr, signature, {
                from: relayer, 
                ...options
            });

        }

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
