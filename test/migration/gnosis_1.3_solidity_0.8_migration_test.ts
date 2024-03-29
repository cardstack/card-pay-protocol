import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import {
  bytes32,
  Cache,
  CHECK_VALUES,
  CONTRACTS,
  debug,
  EMPTY_SLOT,
  fetch,
  forkedDescribe,
  GENESIS_BLOCK,
  getCurrentStorageLayout,
  getDeployedContract,
  getOldStorageLayout,
  isGap,
  KnownSlots,
  mapSlotForKey,
  migrateContract,
  oldLabelToNewLabel,
  oldTypeToNewType,
  RevenueBalance,
  sortContracts,
  StorageLayout,
  StorageLayoutItem,
  switchToReaderImpl,
  uniq,
  UpgradeSlot,
  ZERO_ADDRESS,
} from "./util";
import retry from "async-retry";

const MINUTES = 60 * 1000;

// Note: the migration has now been completed, so these tests will no longer pass.

// Leaving in place as an example of how to test a migration.

forkedDescribe(
  "Gnosis 1.3 / Solidity 0.8 migration test (expected to fail after upgrade is complete)",
  function () {
    let cache: Cache = { _unhandledTypes: new Set() };
    let setReader: Contract;

    before(async () => {
      let factory = await ethers.getContractFactory("EnumerableSetUpgradeUtil");
      setReader = await factory.deploy();
    });

    beforeEach(async () => {
      cache._unhandledTypes = new Set();
    });

    this.timeout(60 * MINUTES);

    for (let contractName of sortContracts(CONTRACTS)) {
      it(`migrates ${contractName}`, async () => {
        await retry(
          async () => {
            debug(`Contract: ${contractName}`);

            let blockNumber = await ethers.provider.getBlockNumber();
            debug(`Current block: ${blockNumber}`);

            let { contract, proxyAdmin, owner, oldImplementation } =
              await getDeployedContract(contractName);

            debug(`Contract storage: ${contract.address}`);
            debug(`Old implementation: ${oldImplementation}`);
            debug(`Owner: ${owner}`);

            await network.provider.request({
              method: "hardhat_impersonateAccount",
              params: [owner],
            });

            let oldStorageLayout = await getOldStorageLayout(contractName);

            let oldValues = {};

            if (CHECK_VALUES) {
              debug("Reading old values");
              for (let storage of oldStorageLayout.storage) {
                oldValues[storage.label] = await readStorage(
                  contract,
                  contractName,
                  storage,
                  oldStorageLayout,
                  setReader,
                  oldImplementation,
                  cache
                );
              }
            }
            let oldOwner = await contract.owner();
            expect(
              await ethers.provider.getStorageAt(contract.address, UpgradeSlot)
            ).to.eq(
              "0x0000000000000000000000000000000000000000000000000000000000000000"
            );

            await migrateContract(contract, contractName, proxyAdmin);

            expect(
              await ethers.provider.getStorageAt(contract.address, UpgradeSlot)
            ).to.eq(
              "0x0000000000000000000000000000000000000000000000000000000000000001",
              "Upgrade completion flag not set after upgrade"
            );
            expect(await contract.owner()).to.eq(
              oldOwner,
              "Owner is not correct after upgrade process"
            );

            let newStorageLayout = await getCurrentStorageLayout(contractName);

            // filter out this added padding so the storage layout length check is correct
            // - actual slot numbers are checked later so this being filtered won't affect
            // property access
            let newStorageSlots = newStorageLayout.storage.filter(
              (storage) => storage.label !== "____gap_Ownable"
            );

            // new set added to store merchant addresses
            newStorageSlots = newStorageSlots.filter(
              (storage) =>
                !(
                  storage.contract ===
                  "contracts/MerchantManager.sol:MerchantManager" && // eslint-disable-line prettier/prettier
                  storage.label === "merchantAddresses"
                )
            );
            expect(newStorageSlots.length).to.eq(
              oldStorageLayout.storage.length
            );

            for (let i = 0; i < newStorageSlots.length; i++) {
              let oldStorage = oldStorageLayout.storage[i];
              let newStorage = newStorageSlots[i];

              if (!isGap(oldStorage, newStorage)) {
                // Labels for gaps are all over the place with the number of underscores for some reason

                expect(newStorage.label).to.eq(
                  oldLabelToNewLabel(oldStorage.label),
                  `Old label: ${oldStorage.label}, new label: ${newStorage.label}`
                );
              }

              expect(newStorage.slot).to.eq(
                oldStorage.slot,
                `Bad slot for ${newStorage.label}`
              );

              let knownSlot: string;

              if (
                (KnownSlots[contractName] &&
                  (knownSlot = KnownSlots[contractName][newStorage.label])) ||
                (knownSlot = KnownSlots["*"][newStorage.label])
              ) {
                // this is checking that the KnownSlots metadata is populated correctly,
                // as it is relied upon for upgrade data reading
                expect(knownSlot).to.eq(
                  newStorage.slot,
                  `Bad slot location for ${contractName}#${newStorage.label}`
                );
              }

              expect(newStorage.offset).to.eq(
                oldStorage.offset,
                `Bad offset for ${newStorage.label}`
              );

              let oldTypeLabel = getTypeLabel(oldStorageLayout, oldStorage);
              let newTypeLabel = getTypeLabel(newStorageLayout, newStorage);

              if (shouldCheckType(oldStorage, newStorage)) {
                expect(newTypeLabel).to.eq(
                  oldTypeToNewType(oldTypeLabel),
                  `Bad type for ${newStorage.label}`
                );
              }

              if (CHECK_VALUES) {
                expect(
                  await readStorage(
                    contract,
                    contractName,
                    newStorage,
                    newStorageLayout,
                    setReader,
                    oldImplementation,
                    cache
                  )
                ).to.eql(
                  oldValues[oldStorage.label],
                  `Mismatch for ${newStorage.label} - ${JSON.stringify(
                    newStorage,
                    null,
                    2
                  )}`
                );
              }
            }

            let endBlockNumber = await ethers.provider.getBlockNumber();
            let blocksMined = endBlockNumber - blockNumber;
            debug(`Total blocks mined for ${contractName}: ${blocksMined}`);
            expect(Array.from(cache._unhandledTypes)).to.eql([]);
          },
          { retries: 3 }
        );
      });
    }
  }
);

function shouldCheckType(
  oldStorage: StorageLayoutItem,
  newStorage: StorageLayoutItem
) {
  if (oldStorage.label == "______gap" && newStorage.label == "__gap") {
    // type of gap may change to allow different storage padding, not an
    // issue if all other types line up
    return false;
  }

  return true;
}

function getTypeLabel(
  storageLayout: StorageLayout,
  storage: StorageLayoutItem
) {
  return storageLayout.types[storage.type].label;
}

async function readStorage(
  contract: Contract,
  contractName: string,
  storage: StorageLayoutItem,
  storageLayout: StorageLayout,
  setReader: Contract,
  oldImplementation: string,
  cache: Cache
) {
  let content: string = await ethers.provider.getStorageAt(
    contract.address,
    BigNumber.from(storage.slot)
  );

  if (isGap(storage, storage)) {
    expect(content).to.eq(EMPTY_SLOT, "______gap not empty");
    return content;
  }

  if (storage.offset > 0) {
    content = content.slice(0, content.length - storage.offset * 2);
  }

  if (storage.type === "t_bool") {
    return content[content.length - 1] === "1";
  }

  let typeLabel = getTypeLabel(storageLayout, storage);
  let readerKey = `${contractName}#${storage.label}: ${typeLabel}`;

  if (
    [
      "address",
      "uint8",
      "uint80",
      "uint256",
      "address payable",
      "string",
      "mapping(address => bytes)",
      "mapping(address => address)",
      "mapping(address => bool)",
      "mapping(string => address)",
      "mapping(bytes32 => bool)",
      "mapping(bytes32 => uint256)",
      "mapping(address => uint256)",
      "mapping(address => string)",
      "mapping(address => mapping(address => address))",
      "mapping(address => mapping(uint256 => bytes32))",
      "mapping(address => mapping(address => uint256))",
      "mapping(uint80 => struct ManualFeed.RoundData)",
      "mapping(address => struct SupplierManager.Supplier)",
      "mapping(bytes32 => struct PrepaidCardMarket.SKU)",
      "mapping(bytes32 => struct Exchange.ExchangeInfo)",
      "mapping(address => struct PrepaidCardManager.CardDetail)",
      "mapping(string => struct PrepaidCardManager.GasPolicy)",
      "mapping(string => struct PrepaidCardManager.GasPolicyV2)",
    ].includes(typeLabel)
  ) {
    // These could be further converted to native / better representations, but
    // for comparison the encoded hex string is fine

    // note that raw mapping types are not checked due to non-iterability, however their storage
    // slot content is checked and mappings with enumerable set content that can be enumerated are
    // explicitly checked
    return content;
  }

  async function switchToReaderImplCurried(
    cb: (readerInstance: Contract) => Promise<unknown>
  ) {
    return await switchToReaderImpl(
      cache,
      setReader,
      oldImplementation,
      contract,
      cb
    );
  }

  if (typeLabel === "struct EnumerableSet.AddressSet") {
    let result = await switchToReaderImplCurried((readerInstance) =>
      readerInstance.readOldAddressSet(bytes32(BigNumber.from(storage.slot)))
    );

    debug(`${readerKey}:`, result);
    return result;
  }

  if (typeLabel === "struct EnumerableSetUpgradeable.AddressSet") {
    let result = await switchToReaderImplCurried(async (readerInstance) => {
      let slotBytes = bytes32(BigNumber.from(storage.slot));
      let result: Array<string> = await readerInstance.readNewAddressSet(
        slotBytes
      );

      // this checks the mapping is correctly populated along with the array
      expect(await readerInstance.newSetContains(slotBytes, ZERO_ADDRESS)).not
        .to.be.ok;
      for (let address of result) {
        expect(await readerInstance.newSetContains(slotBytes, address)).to.be
          .ok;
      }
      return result;
    });

    debug(`${readerKey}:`, result);
    return result;
  }

  async function getRewardProgramIds(): Promise<string[]> {
    return (await fetch(
      cache,
      "RewardManager#rewardProgramIDs",
      async () =>
        await switchToReaderImplCurried(
          async (readerInstance) =>
            await readerInstance.readOldAddressSet(
              bytes32(BigNumber.from(KnownSlots.RewardManager.rewardProgramIDs))
            )
        )
    )) as string[];
  }

  if (
    readerKey ===
    "RewardManager#rewardSafes: mapping(address => struct EnumerableSet.AddressSet)"
  ) {
    let result = {};

    let rewardProgramIds = await getRewardProgramIds();

    await switchToReaderImplCurried(async (readerInstance) => {
      for (let rewardProgramId of rewardProgramIds) {
        let innerRes = await readerInstance.readOldAddressSet(
          mapSlotForKey(rewardProgramId, storage.slot)
        );
        result[rewardProgramId] = innerRes;
      }
    });
    return result;
  }

  if (
    readerKey ===
    "RewardManager#rewardSafes: mapping(address => struct EnumerableSetUpgradeable.AddressSet)"
  ) {
    let result = {};
    let rewardProgramIds = await getRewardProgramIds();

    await switchToReaderImplCurried(async (readerInstance) => {
      for (let rewardProgramId of rewardProgramIds) {
        let mapSlot = mapSlotForKey(rewardProgramId, storage.slot);
        result[rewardProgramId] = await readerInstance.readNewAddressSet(
          mapSlot
        );

        for (let address of result[rewardProgramId]) {
          expect(await readerInstance.newSetContains(mapSlot, address)).to.be;
        }
      }
    });
    return result;
  }
  if (
    readerKey ===
    "MerchantManager#merchants: mapping(address => struct EnumerableSet.AddressSet)"
  ) {
    let merchants: string[] = uniq(
      (
        await contract.queryFilter(
          contract.filters.MerchantCreation(),
          GENESIS_BLOCK
        )
      ).map((e) => e.args.merchant)
    );

    let result = {};

    await switchToReaderImplCurried(async (readerInstance) => {
      for (let merchant of merchants) {
        debug(
          `Reading address set at key ${merchant} for MerchantManager#merchants`
        );

        result[merchant] = await readerInstance.readOldAddressSet(
          mapSlotForKey(merchant, storage.slot)
        );
      }
    });
    return result;
  }
  if (
    readerKey ===
    "MerchantManager#merchants: mapping(address => struct EnumerableSetUpgradeable.AddressSet)"
  ) {
    let merchants = await contract.getMerchantAddresses();

    let result = {};

    await switchToReaderImplCurried(async (readerInstance) => {
      for (let merchant of merchants) {
        debug(
          `Reading address set at key ${merchant} for MerchantManager#merchants`
        );

        result[merchant] = await readerInstance.readNewAddressSet(
          mapSlotForKey(merchant, storage.slot)
        );
      }
    });
    return result;
  }

  if (
    readerKey ===
    "PrepaidCardMarket#inventory: mapping(bytes32 => struct EnumerableSet.AddressSet)"
  ) {
    let events = await contract.queryFilter(
      contract.filters.ItemSet(),
      GENESIS_BLOCK
    );

    let result = {};

    await switchToReaderImplCurried(async (readerInstance) => {
      for (let {
        args: { sku },
      } of events) {
        debug(
          `Reading address set at key ${sku} for PrepaidCardMarket#inventory`
        );
        result[sku] = await readerInstance.readOldAddressSet(
          mapSlotForKey(sku, storage.slot)
        );
      }
    });
    return result;
  }
  if (
    readerKey ===
    "PrepaidCardMarket#inventory: mapping(bytes32 => struct EnumerableSetUpgradeable.AddressSet)"
  ) {
    let events = await contract.queryFilter(
      contract.filters.ItemSet(),
      GENESIS_BLOCK
    );

    let result = {};

    await switchToReaderImplCurried(async (readerInstance) => {
      for (let {
        args: { sku },
      } of events) {
        debug(
          `Reading address set at key ${sku} for PrepaidCardMarket#inventory`
        );

        result[sku] = await readerInstance.readNewAddressSet(
          mapSlotForKey(sku, storage.slot)
        );
      }
    });
    return result;
  }

  if (
    readerKey ===
    "PrepaidCardMarket#inventory: mapping(bytes32 => struct EnumerableSetUpgradeable.AddressSet)"
  ) {
    let events = await contract.queryFilter(
      contract.filters.ItemSet(),
      GENESIS_BLOCK
    );

    let result = {};

    await switchToReaderImplCurried(async (readerInstance) => {
      for (let {
        args: { sku },
      } of events) {
        debug(
          `Reading address set at key ${sku} for PrepaidCardMarket#inventory`
        );

        result[sku] = await readerInstance.readNewAddressSet(
          mapSlotForKey(sku, storage.slot)
        );
      }
    });
    return result;
  }

  if (
    readerKey ===
    "RevenuePool#balances: mapping(address => struct RevenuePool.RevenueBalance)"
  ) {
    let merchantManagerAddress = await contract.merchantManager();

    let merchantManager = await ethers.getContractAt(
      "MerchantManager",
      merchantManagerAddress
    );
    let merchants = await merchantManager.getMerchantAddresses();

    let result: {
      [safeAddress: string]: RevenueBalance;
    } = {};

    for (let merchant of merchants) {
      let merchantSafes = await merchantManager.merchantSafesForMerchant(
        merchant
      );
      for (let merchantSafe of merchantSafes) {
        let balance = {};
        let tokens = await contract.revenueTokens(merchantSafe);
        for (let token of tokens) {
          balance[token] = await contract.revenueBalance(merchantSafe, token);
        }
        result[merchantSafe] = { tokens, balance };
      }
    }

    return result;
  }

  cache._unhandledTypes.add(`Unhandled type ${readerKey}`);
}
