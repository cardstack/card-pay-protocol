var CardModule = artifacts.require('./CardModule.sol')

const notOwnedAddress = '0x0000000000000000000000000000000000000002'
const notOwnedAddress2 = '0x0000000000000000000000000000000000000003'

module.exports = function (deployer) {
  deployer.deploy(CardModule).then(function (module) {
    module.setup(notOwnedAddress, notOwnedAddress2)
    return module
  })
}
