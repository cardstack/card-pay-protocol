import { AbiItem } from 'web3-utils'
import GnosisSafeSol from '@gnosis.pm/safe-contracts/build/contracts/GnosisSafe.json'
import memoize from 'lodash.memoize'
import ProxyFactorySol from '@gnosis.pm/safe-contracts/build/contracts/GnosisSafeProxyFactory.json'
import SafeProxy from '@gnosis.pm/safe-contracts/build/contracts/GnosisSafeProxy.json'
import CardModuleSol from 'build/contracts/CardModule.json'
import CreateAndAddModulesSol from '@gnosis.pm/safe-contracts/build/contracts/CreateAndAddModules.json'
import Web3 from 'web3'

import { ETHEREUM_NETWORK } from 'src/config/networks/network.d'
import { isProxyCode } from 'src/logic/contracts/historicProxyCode'
import { ZERO_ADDRESS } from 'src/logic/wallets/ethAddresses'
import { calculateGasOf, calculateGasPrice } from 'src/logic/wallets/ethTransactions'
import { getWeb3, getNetworkIdFrom } from 'src/logic/wallets/getWeb3'
import { GnosisSafe } from 'src/types/contracts/GnosisSafe.d'
import { GnosisSafeProxyFactory } from 'src/types/contracts/GnosisSafeProxyFactory.d'
import { CardModule } from 'src/types/contracts/CardModule.d'
import { CreateAndAddModules } from 'src/types/contracts/CreateAndAddModules'

export const SENTINEL_ADDRESS = '0x0000000000000000000000000000000000000001'
// GnosisSafe
export const MULTI_SEND_ADDRESS = '0x7121083E8EB8F6e412e0159fC493aA2C11deDf10'
// MasterCopy
export const SAFE_MASTER_COPY_ADDRESS = '0x8042D8D098a31F34Bfb74dDB16ceC1840B41B9bc'
// FallbackManager
export const DEFAULT_FALLBACK_HANDLER_ADDRESS = '0x3409631bc240FE0deBF8976155F20d7854a00B55'
// MasterCopy
export const SAFE_MASTER_COPY_ADDRESS_V10 = '0x0000000000000000000000000000000000000001'

const REACT_APP_NETWORK = process.env.REACT_APP_NETWORK

const REVENUE_POOL_ADDRESS = process.env.REVENUE_POOL_ADDRESS || '0x450230fe1d0a7d31ed9da2adbe7914f964842cbb'
const CARD_STACK_ADMIN_ADDRESS = process.env.CARD_STACK_ADMIN_ADDRESS || '0xFf0A8d6240F6B44820fFaB7C2683Ff64a5b16D21'

let proxyFactoryMaster: GnosisSafeProxyFactory
let safeMaster: GnosisSafe
let cardModule: CardModule
let createAndAddModules: CreateAndAddModules

/**
 * Creates a Contract instance of the GnosisSafe contract
 * @param {Web3} web3
 * @param {ETHEREUM_NETWORK} networkId
 */
const createGnosisSafeContract = (web3: Web3, networkId: ETHEREUM_NETWORK) => {
  const networks = GnosisSafeSol.networks
  // TODO: this may not be the most scalable approach,
  //  but up until v1.2.0 the address is the same for all the networks.
  //  So, if we can't find the network in the Contract artifact, we fallback to MAINNET.

  // GnosisSafe
  const contractAddress =
    networks[networkId]?.address ?? REACT_APP_NETWORK === 'sokol'
      ? '0x8042D8D098a31F34Bfb74dDB16ceC1840B41B9bc'
      : networks[ETHEREUM_NETWORK.MAINNET].address
  return (new web3.eth.Contract(GnosisSafeSol.abi as AbiItem[], contractAddress) as unknown) as GnosisSafe
}

/**
 * Creates a Contract instance of the GnosisSafeProxyFactory contract
 * @param {Web3} web3
 * @param {ETHEREUM_NETWORK} networkId
 */
const createProxyFactoryContract = (web3: Web3, networkId: ETHEREUM_NETWORK): GnosisSafeProxyFactory => {
  const networks = ProxyFactorySol.networks
  // TODO: this may not be the most scalable approach,
  //  but up until v1.2.0 the address is the same for all the networks.
  //  So, if we can't find the network in the Contract artifact, we fallback to MAINNET.

  // GnosisSafeProxyFactory
  const contractAddress =
    networks[networkId]?.address ?? REACT_APP_NETWORK === 'sokol'
      ? '0x9b9b8A537a5A1AF08F50F6724E9c2db7Fd9459B4'
      : networks[ETHEREUM_NETWORK.MAINNET].address
  return (new web3.eth.Contract(ProxyFactorySol.abi as AbiItem[], contractAddress) as unknown) as GnosisSafeProxyFactory
}

/**
 * Creates a Contract instance of the CardModule contract
 * @param {Web3} web3
 * @param {ETHEREUM_NETWORK} networkId
 */
const createCardModuleContract = (web3: Web3, networkId: ETHEREUM_NETWORK): CardModule => {
  const networks = CardModuleSol.networks

  // CardModule
  const contractAddress =
    networks[networkId]?.address ?? REACT_APP_NETWORK === 'sokol'
      ? '0x4F0EA6Cd2b30051b2Cde8C811C591F575121316D'
      : networks[ETHEREUM_NETWORK.MAINNET].address
  return (new web3.eth.Contract(CardModuleSol.abi as AbiItem[], contractAddress) as unknown) as CardModule
}

/**
 * Creates a Contract instance of the CreateAndAddModule contract
 * @param {Web3} web3
 * @param {ETHEREUM_NETWORK} networkId
 */
const createCreateAndAddModuleContract = (web3: Web3, networkId: ETHEREUM_NETWORK): CreateAndAddModules => {
  const networks = CreateAndAddModulesSol.networks
  // TODO: this may not be the most scalable approach,
  //  but up until v1.2.0 the address is the same for all the networks.
  //  So, if we can't find the network in the Contract artifact, we fallback to MAINNET.

  // CreateAndAddModule
  const contractAddress =
    networks[networkId]?.address ?? REACT_APP_NETWORK === 'sokol'
      ? '0x0A95aA12FFb7aEB3514eC2Bc1464A6A8db030FcB'
      : networks[ETHEREUM_NETWORK.MAINNET].address
  return (new web3.eth.Contract(
    CreateAndAddModulesSol.abi as AbiItem[],
    contractAddress,
  ) as unknown) as CreateAndAddModules
}

export const getGnosisSafeContract = memoize(createGnosisSafeContract)

const getCreateProxyFactoryContract = memoize(createProxyFactoryContract)

const getCardModuleContract = memoize(createCardModuleContract)

const getCreateAndAddModulesContract = memoize(createCreateAndAddModuleContract)

const instantiateMasterCopies = async () => {
  const web3 = getWeb3()
  const networkId = await getNetworkIdFrom(web3)

  // Create ProxyFactory Master Copy
  proxyFactoryMaster = getCreateProxyFactoryContract(web3, networkId)

  // Create Safe Master copy
  safeMaster = getGnosisSafeContract(web3, networkId)

  // Create Whitelist Module Master copy
  cardModule = getCardModuleContract(web3, networkId)

  // Create CreateAndAddModules
  createAndAddModules = getCreateAndAddModulesContract(web3, networkId)
}

const createAndAddModulesDataUtil = (dataArray) => {
  const web3 = getWeb3()
  // Remove method id (10) and position of data in payload (64)
  return dataArray.reduce(
    (acc, data) =>
      acc +
      new web3.eth.Contract([
        {
          constant: false,
          inputs: [{ name: 'data', type: 'bytes' }],
          name: 'setup',
          outputs: [],
          payable: false,
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ]).methods
        .setup(data)
        .encodeABI()
        .substr(74),
    '0x',
  )
}

export const initContracts = instantiateMasterCopies

export const getSafeMasterContract = async () => {
  await initContracts()

  return safeMaster
}

export const getSafeDeploymentTransaction = (safeAccounts, numConfirmations) => {
  // Create Gnosis Safe and CardModule Module in one transactions
  const moduleData = cardModule.methods.setup(REVENUE_POOL_ADDRESS, CARD_STACK_ADMIN_ADDRESS).encodeABI()
  const proxyFactoryData = proxyFactoryMaster.methods.createProxy(cardModule.options.address, moduleData).encodeABI()
  const modulesCreationData = createAndAddModulesDataUtil([proxyFactoryData])
  const createAndAddModulesData = createAndAddModules.methods
    .createAndAddModules(proxyFactoryMaster.options.address, modulesCreationData)
    .encodeABI()
  const gnosisSafeData = safeMaster.methods
    .setup(
      [CARD_STACK_ADMIN_ADDRESS].concat(safeAccounts),
      safeAccounts.length + 1,
      createAndAddModules.options.address,
      createAndAddModulesData,
      DEFAULT_FALLBACK_HANDLER_ADDRESS,
      ZERO_ADDRESS,
      0,
      ZERO_ADDRESS,
    )
    .encodeABI()
  // const gnosisSafeData = safeMaster.methods
  //   .setup(
  //     safeAccounts,
  //     numConfirmations,
  //     ZERO_ADDRESS,
  //     '0x',
  //     DEFAULT_FALLBACK_HANDLER_ADDRESS,
  //     ZERO_ADDRESS,
  //     0,
  //     ZERO_ADDRESS,
  //   )
  //   .encodeABI()

  return proxyFactoryMaster.methods.createProxy(safeMaster.options.address, gnosisSafeData)
}

export const estimateGasForDeployingSafe = async (safeAccounts, numConfirmations, userAccount) => {
  // Create Gnosis Safe and CardModule Module in one transactions
  const moduleData = cardModule.methods.setup(REVENUE_POOL_ADDRESS, CARD_STACK_ADMIN_ADDRESS).encodeABI()
  let _proxyFactoryData = proxyFactoryMaster.methods.createProxy(cardModule.options.address, moduleData).encodeABI()
  let modulesCreationData = createAndAddModulesDataUtil([_proxyFactoryData])
  let createAndAddModulesData = createAndAddModules.methods
    .createAndAddModules(proxyFactoryMaster.options.address, modulesCreationData)
    .encodeABI()
  let gnosisSafeData = safeMaster.methods
    .setup(
      [CARD_STACK_ADMIN_ADDRESS].concat(safeAccounts),
      safeAccounts.length + 1,
      createAndAddModules.options.address,
      createAndAddModulesData,
      DEFAULT_FALLBACK_HANDLER_ADDRESS,
      ZERO_ADDRESS,
      0,
      ZERO_ADDRESS,
    )
    .encodeABI()
  const proxyFactoryData = proxyFactoryMaster.methods
    .createProxy(safeMaster.options.address, gnosisSafeData)
    .encodeABI()
  const gas = await calculateGasOf(proxyFactoryData, userAccount, proxyFactoryMaster.options.address)
  const gasPrice = await calculateGasPrice()

  return gas * parseInt(gasPrice, 10)
}

export const getGnosisSafeInstanceAt = (safeAddress: string): GnosisSafe => {
  const web3 = getWeb3()
  return (new web3.eth.Contract(GnosisSafeSol.abi as AbiItem[], safeAddress) as unknown) as GnosisSafe
}

export const getCardModuleInstanceAt = (safeAddress: string): CardModule => {
  const web3 = getWeb3()
  return (new web3.eth.Contract(CardModuleSol.abi as AbiItem[], safeAddress) as unknown) as CardModule
}

const cleanByteCodeMetadata = (bytecode: string): string => {
  const metaData = 'a165'
  return bytecode.substring(0, bytecode.lastIndexOf(metaData))
}

export const validateProxy = async (safeAddress: string): Promise<boolean> => {
  // https://solidity.readthedocs.io/en/latest/metadata.html#usage-for-source-code-verification
  const web3 = getWeb3()
  const code = await web3.eth.getCode(safeAddress)
  const codeWithoutMetadata = cleanByteCodeMetadata(code)
  const supportedProxies = [SafeProxy]
  for (let i = 0; i < supportedProxies.length; i += 1) {
    const proxy = supportedProxies[i]
    const proxyCode = proxy.deployedBytecode
    const proxyCodeWithoutMetadata = cleanByteCodeMetadata(proxyCode)
    if (codeWithoutMetadata === proxyCodeWithoutMetadata) {
      return true
    }
  }

  return isProxyCode(codeWithoutMetadata)
}
