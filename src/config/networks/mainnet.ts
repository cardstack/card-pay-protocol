import EtherLogo from 'src/config/assets/token_eth.svg'
import { EnvironmentSettings, ETHEREUM_NETWORK, NetworkConfig } from 'src/config/networks/network.d'

const baseConfig: EnvironmentSettings = {
  txServiceUrl: 'https://safe-transaction.mainnet.staging.gnosisdev.com/api/v1',
  safeAppsUrl: 'https://safe-apps.dev.gnosisdev.com',
  gasPriceOracle: {
    url: 'https://ethgasstation.info/json/ethgasAPI.json',
    gasParameter: 'average',
  },
  rpcServiceUrl: 'https://mainnet.infura.io:443/v3',
  networkExplorerName: 'Etherscan',
  networkExplorerUrl: 'https://etherscan.io',
  networkExplorerApiUrl: 'https://api.etherscan.io/api',
}

const mainnet: NetworkConfig = {
  environment: {
    dev: {
      ...baseConfig,
    },
    staging: {
      ...baseConfig,
      safeAppsUrl: 'https://safe-apps.staging.gnosisdev.com',
    },
    production: {
      ...baseConfig,
      txServiceUrl: 'https://safe-transaction.mainnet.gnosis.io/api/v1',
      safeAppsUrl: 'https://apps.gnosis-safe.io',
    },
  },
  network: {
    id: ETHEREUM_NETWORK.MAINNET,
    backgroundColor: '#E8E7E6',
    textColor: '#001428',
    label: 'Mainnet',
    isTestNet: false,
    nativeCoin: {
      address: '0x000',
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
      logoUri: EtherLogo,
    },
  }
}

export default mainnet
