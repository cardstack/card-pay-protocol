import { BaseProvider, JsonRpcProvider } from "@ethersproject/providers";

import { hashBytecodeWithoutMetadata } from "@openzeppelin/upgrades-core";
import axios from "axios";
import { diffLines } from "diff";
import colors from "colors/safe";
import Table from "cli-table3";
import { debug as debugFactory } from "debug";
import { prompt } from "enquirer";
import { Contract, ContractFactory, VoidSigner } from "ethers";
import { existsSync } from "fs";
import { readJSONSync, writeJsonSync } from "fs-extra";
import hre from "hardhat";
import {
  HardhatNetworkHDAccountsConfig,
  HttpNetworkConfig,
} from "hardhat/types";
import { sortBy } from "lodash";
import { resolve } from "path";
import TrezorWalletProvider from "trezor-cli-wallet-provider";
import { ZERO_ADDRESS } from "../../test/migration/util";
import { AddressFile, CALL, getNetwork, SafeTxTypes } from "./config-utils";
import { default as contractInitSpec } from "./contract-init-spec";
import { patchNetworks } from "./patchNetworks";
import { Interface } from "@ethersproject/abi";

export { patchNetworks };
export { contractInitSpec };
export { getNetwork };
patchNetworks();

const debug = debugFactory("card-protocol.deploy");

const {
  upgrades: {
    deployProxy,
    erc1967: { getImplementationAddress },
  },
  ethers,
  config: {
    networks: {
      hardhat: { accounts },
    },
  },
} = hre;

const { mnemonic } = accounts as HardhatNetworkHDAccountsConfig;

function getHardhatTestWallet() {
  let provider = ethers.getDefaultProvider("http://localhost:8545");
  // This is the default hardhat test mnemonic
  let wallet = ethers.Wallet.fromMnemonic(
    mnemonic || "test test test test test test test test test test test junk"
  );
  return wallet.connect(provider);
}

export async function makeFactory(
  contractName: string
): Promise<ContractFactory> {
  if (hre.network.name === "hardhat") {
    return await ethers.getContractFactory(contractName);
  } else if (hre.network.name === "localhost" && !process.env.HARDHAT_FORKING) {
    return (await ethers.getContractFactory(contractName)).connect(
      getHardhatTestWallet()
    );
  }

  return (await ethers.getContractFactory(contractName)).connect(
    getSigner(await getDeployAddress())
  );
}

function getRpcUrl(): string {
  const {
    network: { config },
  } = hre;
  const { url: rpcUrl } = config as HttpNetworkConfig;

  return rpcUrl;
}

// VoidSigner is the same as Signer but implements TypedDataSigner interface
export function getSigner(address?: string): VoidSigner {
  const {
    network: { name: network, config },
  } = hre;

  const { chainId, url: rpcUrl } = config as HttpNetworkConfig;
  const { derivationPath } = config as unknown as { derivationPath: string };

  if (
    network === "localhost" &&
    (!process.env.HARDHAT_FORKING || process.env.IMPERSONATE_ADDRESS)
  ) {
    let provider = ethers.getDefaultProvider(
      "http://localhost:8545"
    ) as JsonRpcProvider;

    return provider.getSigner(address) as unknown as VoidSigner;
  }

  if (process.env.DEPLOY_MNEMONIC) {
    let provider = ethers.getDefaultProvider(rpcUrl) as JsonRpcProvider;
    return ethers.Wallet.fromMnemonic(
      process.env.DEPLOY_MNEMONIC,
      process.env.DEPLOY_MNEMONIC_DERIVATION_PATH
    ).connect(provider) as unknown as VoidSigner;
  } else {
    debug("No DEPLOY_MNEMONIC found, using trezor");
    const walletProvider = new TrezorWalletProvider(rpcUrl, {
      chainId: chainId,
      numberOfAccounts: 3,
      derivationPath,
    });
    let trezorProvider = new ethers.providers.Web3Provider(
      walletProvider,
      network
    );
    return trezorProvider.getSigner(address) as unknown as VoidSigner;
  }
}

let deployAddress: string;
export async function getDeployAddress(): Promise<string> {
  if (deployAddress) {
    return deployAddress;
  }
  if (hre.network.name === "hardhat") {
    let [signer] = await ethers.getSigners();
    deployAddress = signer.address;
  } else if (hre.network.name === "localhost" && !process.env.HARDHAT_FORKING) {
    deployAddress = getHardhatTestWallet().address;
  } else if (process.env.IMPERSONATE_ADDRESS) {
    debug(`Impersonating ${process.env.IMPERSONATE_ADDRESS}`);
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [process.env.IMPERSONATE_ADDRESS],
    });
    return process.env.IMPERSONATE_ADDRESS;
  } else {
    deployAddress = await getSigner().getAddress();
    if (
      !process.env.HARDHAT_FORKING &&
      !(await confirm(
        `Send transactions from address ${deployAddress}? (No further confirmations for mnemnonic-derived addresses)`
      ))
    ) {
      process.exit(1);
    }
  }
  return deployAddress;
}

export function asyncMain(main: { (...args: unknown[]): Promise<void> }): void {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

type RetryCallback<T> = () => Promise<T>;

export async function retry<T>(
  cb: RetryCallback<T>,
  maxAttempts = 10
): Promise<T> {
  let attempts = 0;
  do {
    await delay(1000 + attempts * 1000);
    try {
      attempts++;
      return await cb();
    } catch (e) {
      debug(
        `received ${e.message}, trying again (${attempts} of ${maxAttempts} attempts)`
      );

      if (e.stack) {
        debug(e.stack);
      }
    }
  } while (attempts < maxAttempts);

  throw new Error("Reached max retry attempts");
}

// This waits for nonce increase after doing a transaction to prevent the next
// transaction having the wrong nonce
export async function retryAndWaitForNonceIncrease<T>(
  cb: RetryCallback<T>,
  address = null,
  maxAttempts = 10
): Promise<T> {
  if (!address) {
    address = await getDeployAddress();
  }
  let oldNonce = await ethers.provider.getTransactionCount(address);

  let result = await retry(cb, maxAttempts);
  await retry(async () => {
    if ((await ethers.provider.getTransactionCount(address)) === oldNonce) {
      throw new Error(`Nonce not increased yet for ${address}`);
    }
  });
  return result;
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deployedCodeMatches(
  contractName: string,
  proxyAddress: string
): Promise<boolean> {
  let currentImplementationAddress = await getImplementationAddress(
    proxyAddress
  );
  debug(
    `Checking implementation of ${contractName}@${proxyAddress} (curent implementation: ${currentImplementationAddress})`
  );

  return await deployedImplementationMatches(
    contractName,
    currentImplementationAddress
  );
}

// If you are using a forked node, you can update the contract code locally and use
// this function to set this code for the local fork to the new bytecode for debugging
export async function setCodeToLocal(
  contractName: string,
  address: string
): Promise<void> {
  let artifact = hre.artifacts.require(contractName);
  artifact.deployedBytecode;

  await hre.network.provider.request({
    method: "hardhat_setCode",
    params: [address, artifact.deployedBytecode],
  });
}

export async function deployedImplementationMatches(
  contractName: string,
  implementationAddress: string
): Promise<boolean> {
  let artifact = hre.artifacts.require(contractName);

  let deployedCode = await getProvider().getCode(implementationAddress);
  if (!deployedCode || deployedCode === "0x") {
    return;
  }

  let deployedCodeHash = hashBytecodeWithoutMetadata(deployedCode);
  let localCodeHash = hashBytecodeWithoutMetadata(artifact.deployedBytecode);

  debug(
    `On chain code hash at ${implementationAddress} (without metadata): ${deployedCodeHash}`
  );

  debug(`Local bytecode hash (without metadata): ${localCodeHash}`);

  return deployedCodeHash === localCodeHash;
}

export async function deployNewProxyAndImplementation(
  contractName: string,
  constructorArgs: unknown[]
): Promise<Contract> {
  return await retry(async () => {
    try {
      debug(`Creating factory`);
      let factory = await makeFactory(contractName);
      debug(`Deploying proxy with constructorArgs`, constructorArgs);
      let instance = await deployProxy(factory, constructorArgs);
      debug("Waiting for transaction");
      await instance.deployed();
      return instance;
    } catch (e) {
      debug(e);
      throw new Error("It failed, retrying");
    }
  });
}

export async function getProxies(network: string): Promise<string[]> {
  let upgradeManager = await getUpgradeManager(network);
  return await upgradeManager.getProxies();
}

export async function getProxyAddresses(network: string): Promise<AddressFile> {
  let proxies = await getProxies(network);
  let upgradeManager = await getUpgradeManager(network);

  let addresses: AddressFile = {};
  for (let proxyAddress of proxies) {
    let id = await upgradeManager.getAdoptedContractId(proxyAddress);
    addresses[id] = { proxy: proxyAddress };
  }

  return addresses;
}

export async function reportProtocolStatus(
  network: string,
  includeUnchanged = false
): Promise<{ table: Table.Table; anyChanged: boolean }> {
  let upgradeManager = await getUpgradeManager(network, true);

  let proxyAddresses = await upgradeManager.getProxies();

  let contracts = contractInitSpec({ network });

  let anyChanged = false;

  let table = new Table({
    head: [
      "Contract ID",
      "Contract Name",
      "Proxy Address",
      "Current Implementation Address",
      "Proposed Implementation Address",
      "Proposed Function Call",
      "Local Bytecode Changed",
    ],
  });

  for (let proxyAddress of proxyAddresses) {
    let adoptedContract = await upgradeManager.adoptedContractsByProxyAddress(
      proxyAddress
    );
    let contractName = contracts[adoptedContract.id].contractName;
    let contract = await ethers.getContractAt(contractName, proxyAddress);

    let localBytecodeChanged = (await deployedCodeMatches(
      contractName,
      proxyAddress
    ))
      ? null
      : "YES";

    let codeChanges =
      adoptedContract.upgradeAddress !== ZERO_ADDRESS ||
      adoptedContract.encodedCall !== "0x" ||
      localBytecodeChanged;

    if (codeChanges) {
      anyChanged = true;
    }

    if (!codeChanges && !includeUnchanged) {
      continue;
    }

    let formattedCall = null;
    if (adoptedContract.encodedCall !== "0x") {
      formattedCall = decodeEncodedCall(contract, adoptedContract.encodedCall);

      try {
        await getProvider().call({
          data: adoptedContract.encodedCall,
          to: contract.address,
          from: upgradeManager.address,
        });
      } catch (e) {
        formattedCall = `${formattedCall}\nFAILING CALL!: ${extractErrorMessage(
          e
        )}`;
      }
    }

    table.push([
      adoptedContract.id,
      contractName,
      proxyAddress,
      await getImplementationAddress(proxyAddress),
      adoptedContract.upgradeAddress !== ZERO_ADDRESS
        ? adoptedContract.upgradeAddress
        : null,
      formattedCall,
      localBytecodeChanged,
    ]);
  }

  return { table, anyChanged };
}

export async function proposedDiff(contractId: string): Promise<void> {
  let network = getNetwork();
  let upgradeManager = await getUpgradeManager(network, true);

  let proxyAddress = await upgradeManager.adoptedContractAddresses(contractId);
  let currentImplementationAddress = await getImplementationAddress(
    proxyAddress
  );
  let proposedImplementationAddress =
    await upgradeManager.getPendingUpgradeAddress(proxyAddress);

  if (!proposedImplementationAddress) {
    throw new Error(`no new implementation proposed for ${contractId}`);
  }

  debug(
    "Current implementation address",
    currentImplementationAddress,
    "proposed implementation address",
    proposedImplementationAddress
  );

  debug("Fetching source code for current implementation…");
  let currentCode = await getSourceCode(currentImplementationAddress, network);
  debug("Fetching source code for proposed implementation…");
  let proposedCode = await getSourceCode(
    proposedImplementationAddress,
    network
  );

  let diff = diffLines(currentCode, proposedCode);
  diff.forEach((part) => {
    // green for additions, red for deletions
    // grey for common parts
    const color = part.added ? "green" : part.removed ? "red" : "grey";
    process.stderr.write(colors[color](part.value));
  });
}

async function getSourceCode(address: string, network: string) {
  let result = await getSourceCodeData(address, network);
  let code: string = result.AdditionalSources.map(
    (s) => `// ${s.Filename}\n=================\n\n${s.SourceCode}`
  ).join("\n\n");

  return code.concat(
    "\n\n// Main Contract Code\n===============\n\n",
    result.SourceCode
  );
}

async function getSourceCodeData(address: string, network: string) {
  let apiUrl = {
    sokol: "https://blockscout.com/poa/sokol/api",
    xdai: "https://blockscout.com/poa/xdai/api",
  }[network];
  let url = `${apiUrl}?module=contract&action=getsourcecode&address=${address}`;
  const {
    data: {
      result: [result],
    },
  } = await axios.get(url);

  if (!result.SourceCode) {
    throw new Error(
      `Missing SourceCode for ${address}, contract may not be verified`
    );
  }
  return result;
}

export function getProvider(): BaseProvider {
  return ethers.getDefaultProvider(getRpcUrl());
}
export async function getChainId(): Promise<number> {
  return (await getProvider().getNetwork()).chainId;
}

export function strip0x(data: string): string {
  if (data[0] === "0" && data[1] === "x") {
    return data.slice(2);
  } else {
    throw new Error(`String does not start with 0x: ${data}`);
  }
}

export function decodeEncodedCall(
  contract: Contract | ContractFactory,
  encodedCall: string
): string {
  return decodeEncodedCallWithInterface(contract.interface, encodedCall);
}

export function decodeEncodedCallWithInterface(
  iface: Interface,
  encodedCall: string
): string {
  let tx = iface.parseTransaction({ data: encodedCall });
  let {
    functionFragment: { name, inputs },
    args,
  } = tx;

  function format(arg: unknown) {
    if (Array.isArray(arg)) {
      return JSON.stringify(arg);
    } else {
      return arg;
    }
  }
  let formattedArgs = inputs.map(
    (input, i) => `\n  ${input.type} ${input.name || ""}: ${format(args[i])}`
  );

  return `${name}(${formattedArgs.join()}\n)`;
}

export async function getUpgradeManager(
  network: string,
  readOnly = false
): Promise<Contract> {
  let upgradeManagerAddress = readMetadata("upgradeManagerAddress", network);
  let signer: VoidSigner;
  if (!readOnly) {
    signer = getSigner(await getDeployAddress());
  }
  return await ethers.getContractAt(
    "UpgradeManager",
    upgradeManagerAddress,
    signer
  );
}

export async function getOrDeployUpgradeManager(
  network: string,
  owner: string
): Promise<Contract> {
  if (readMetadata("upgradeManagerAddress", network)) {
    let upgradeManager = await getUpgradeManager(network);
    let nonce = await upgradeManager.nonce(); // Sanity check that it's a real contract
    debug(
      `Found existing upgrade manager at ${upgradeManager.address}, nonce ${nonce}`
    );
    return upgradeManager;
  } else {
    debug(`Deploying new upgrade manager`);
    let UpgradeManager = await makeFactory("UpgradeManager");

    let upgradeManager = await deployProxy(UpgradeManager, [owner]);
    await upgradeManager.deployed();

    debug(`Deployed new upgrade manager to ${upgradeManager.address}`);
    writeMetadata("upgradeManagerAddress", upgradeManager.address, network);
    return upgradeManager;
  }
}

export function extractErrorMessage(e: { error: { body: string } }): string {
  // missing revert data in call exception error causing this horrible lookup pattern
  if (e.error && e.error.body) {
    return JSON.parse(e.error.body).error.message;
  } else {
    console.log(e);
    throw e;
  }
}

export function readMetadata(
  key: string,
  network: string = getNetwork()
): string {
  let path = metadataPath(network);
  if (existsSync(path)) {
    return readJSONSync(path)[key];
  }
}
export function writeMetadata(
  key: string,
  value: unknown,
  network: string = getNetwork()
): void {
  let path = metadataPath(network);
  let metadata = {};
  if (existsSync(path)) {
    metadata = readJSONSync(path);
  }

  metadata[key] = value;

  writeJsonSync(path, metadata);
}

function metadataPath(network: string) {
  return resolve(__dirname, `../../.openzeppelin/metadata-${network}.json`);
}

export async function confirm(message: string): Promise<boolean> {
  if (process.env.CARDPAY_AUTOCONFIRM == "true") {
    return true;
  }

  let { question } = (await prompt({
    type: "confirm",
    name: "question",
    message,
  })) as { question: boolean };

  return question;
}

export async function contractWithSigner(
  contract: Contract,
  signer: string
): Promise<Contract> {
  return contract.connect(getSigner(signer));
}

export function encodeWithSignature(
  signature: string,
  ...args: unknown[]
): string {
  let iface = new ethers.utils.Interface([`function ${signature}`]);
  return iface.encodeFunctionData(signature, args);
}

export function assert(test: boolean, message: string): void {
  if (!test) {
    throw new Error(message);
  }
}

export async function safeTransaction({
  signerAddress,
  safeAddress,
  to,
  data,
  priorSignatures = [],
  value = 0,
  operation = CALL,
  safeTxGas = 0,
  baseGas = 0,
  gasPrice = 0,
  gasToken = ZERO_ADDRESS,
  refundReceiver = ZERO_ADDRESS,
}: {
  signerAddress: string;
  safeAddress: string;
  to: string;
  data: string;
  priorSignatures?: Array<SafeSignature> | true;
  value?: number;
  operation?: number;
  safeTxGas?: number;
  baseGas?: number;
  gasPrice?: number;
  gasToken?: string;
  refundReceiver?: string;
}): Promise<void> {
  if (priorSignatures === true) {
    if (process.env.PRIOR_SIGNATURES?.length) {
      priorSignatures = JSON.parse(process.env.PRIOR_SIGNATURES);
    } else {
      priorSignatures = [];
    }
  }

  priorSignatures = priorSignatures as Array<SafeSignature>;

  let signer = getSigner(signerAddress);
  let safe = await ethers.getContractAt("GnosisSafe", safeAddress, signer);
  debug("Preparing for safe transaction using safe", safeAddress);
  let safeVersion = await safe.VERSION();
  debug("It looks like a safe, version", safeVersion);
  let safeOwners = await safe.getOwners();
  if (!safeOwners.includes(signerAddress)) {
    throw new Error(
      `Signer address ${signerAddress} is not an owner of safe ${safe.address}`
    );
  }
  let threshold = await safe.getThreshold();
  let nonce = (await safe.nonce()).toNumber();

  debug(
    `We have ${priorSignatures.length} prior signatures, and the safe threshold is ${threshold}. Safe nonce is ${nonce}.`
  );

  if (priorSignatures.some((s) => s.signer === signerAddress.toLowerCase())) {
    throw new Error(
      `Signer ${signerAddress} is already included in priorSignatures`
    );
  }

  let chainId = await getChainId();

  let domain = {
    verifyingContract: safe.address,
    chainId,
  };

  let message = {
    to,
    value,
    data,
    operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    nonce,
  };

  let signatureBytes = await signer._signTypedData(
    domain,
    SafeTxTypes,
    message
  );

  let signature: SafeSignature = {
    signer: signerAddress.toLowerCase(),
    signatureBytes,
  };
  debug("Signature:", signature);

  let signatures = [...priorSignatures, signature];

  if (signatures.length >= threshold.toNumber()) {
    debug("We have enough signatures, submitting safe transaction");

    if (!(await confirm("Execute safe transaction?"))) {
      process.exit(1);
    }

    let concatenatedSignatures =
      "0x" +
      sortBy(signatures, (s) => s.signer)
        .map((s) => s.signatureBytes)
        .map(strip0x)
        .join("");

    let receipt = await retryAndWaitForNonceIncrease(async () => {
      let tx = await safe.execTransaction(
        to,
        value,
        data,
        operation,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        concatenatedSignatures
      );

      debug("Submitted transaction", tx.hash);

      return await tx.wait();
    });

    debug("Transaction successful", receipt.transactionHash);
  } else {
    debug(
      "We only have",
      signatures.length,
      "signatures, but the threshold is",
      threshold.toString()
    );
    debug(
      "Still not enough signatures to submit, please gather",
      threshold - signatures.length,
      "more signatures. Current signature list:"
    );
    debug(JSON.stringify(signatures));
  }
}

type SafeSignature = {
  signer: string;
  signatureBytes: string;
};
