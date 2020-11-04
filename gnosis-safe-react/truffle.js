const HDWalletProvider = require('@truffle/hdwallet-provider')
require('dotenv').config()
const package = require('./package')
const mnemonic = process.env.MNEMONIC

module.exports = {
  migrations_directory: './migrations',
  networks: {
    development: {
      host: 'localhost',
      port: 8545,
      network_id: '*', //* Match any network id
    },
    sokol: {
      provider: () => {
        return new HDWalletProvider(mnemonic, 'https://sokol.poa.network')
      },
      network_id: '77',
      gasPrice: 10000000000,
    },
  },
  solc: {
    optimizer: {
      enabled: true,
      runs: 500,
    },
  },
}
