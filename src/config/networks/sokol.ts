import EtherLogo from 'src/config/assets/token_eth.svg'
import { EnvironmentSettings, ETHEREUM_NETWORK, NetworkConfig } from 'src/config/networks/network.d'

const baseConfig: EnvironmentSettings = {
  txServiceUrl: 'http://localhost:8000/api/v1',
  safeAppsUrl: 'https://safe-apps.dev.gnosisdev.com',
  gasPriceOracle: {
    url: 'https://gasprice.poa.network/',
    gasParameter: 'standard',
  },
  rpcServiceUrl: 'https://sokol.poa.network',
  networkExplorerName: 'Blockscout',
  networkExplorerUrl: 'https://blockscout.com/poa/sokol',
  networkExplorerApiUrl: 'https://blockscout.com/poa/sokol/api',
}

const sokol: NetworkConfig = {
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
      txServiceUrl: 'http://localhost:8000/api/v1',
      safeAppsUrl: 'https://apps.gnosis-safe.io',
    },
  },
  network: {
    id: ETHEREUM_NETWORK.SOKOL,
    backgroundColor: '#E8673C',
    textColor: '#ffffff',
    label: 'Sokol',
    isTestNet: true,
    nativeCoin: {
      address: '0x000',
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
      logoUri: EtherLogo,
    },
  },
}

export default sokol
