const web3Utils = require('web3-utils');
const gnosisUtils = require('@gnosis.pm/safe-contracts/test/utils/general');

exports = Object.assign({}, gnosisUtils);

function fromDAICPXD2SPEND(amount, exchangeRate) {
    return web3Utils.toWei(web3Utils.toBN(amount)).mul(web3Utils.toBN(exchangeRate)).toString();
}

function toAmountToken(amount, decimals = '18') {
    let dec = web3Utils.toBN('10').pow(web3Utils.toBN(decimals))
    return web3Utils.toBN(amount).mul(dec);
}

Object.assign(exports, {
    fromDAICPXD2SPEND, 
    toAmountToken
})

module.exports = exports;