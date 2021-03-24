const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const SPEND = artifacts.require('SPEND');

const fs = require('fs');
const mkdirp = require('mkdirp');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

async function getCurrentBranch() {
    return await exec('git branch --show-current');
}
  

module.exports = async function (deployer, network, account) {
    if (network == "ganache")
        return;
    let prepaidCardManager = await PrepaidCardManager.deployed();
    let pool = await RevenuePool.deployed();
    let spend = await SPEND.deployed();

    let branch = await getCurrentBranch();
    let name = `${branch.trim()}`;

    let addresses = {
        "RevenuePool": pool.address, 
        "PrepaidCardManager": prepaidCardManager.address, 
        "SPEND": spend.address
    }; 

    let path = __dirname + `/../address_book`;
    console.log(path);
    await mkdirp(path);
    fs.writeFileSync(path + `/${name}.json`, JSON.stringify(addresses));
}