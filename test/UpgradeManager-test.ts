import { Contract, ContractFactory } from "ethers";
import { contract, ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { setupVersionManager } from "./utils/helper";

const {
  deployProxy,
  prepareUpgrade,

  erc1967: { getAdminAddress },
} = upgrades;

contract.only("UpgradeManager", (accounts) => {
  let [owner, upgradeProposer, randomEOA] = accounts;

  let upgradeManager: Contract,
    versionManager: Contract,
    UpgradeableContractV1: ContractFactory,
    UpgradeableContractV2: ContractFactory;

  before(async () => {
    let UpgradeManager = await ethers.getContractFactory("UpgradeManager");
    UpgradeableContractV1 = await ethers.getContractFactory(
      "UpgradeableContractV1"
    );
    UpgradeableContractV2 = await ethers.getContractFactory(
      "UpgradeableContractV2"
    );

    versionManager = await setupVersionManager(owner);

    upgradeManager = await UpgradeManager.deploy();
    await upgradeManager.initialize(owner);
    await upgradeManager.setup([], versionManager.address);
  });

  async function deployV1(): Promise<Contract> {
    let instance = await deployProxy(UpgradeableContractV1);
    let proxyAdminAddress = await getAdminAddress(instance.address);

    let proxyAdmin = await ethers.getContractAt(
      "IProxyAdmin",
      proxyAdminAddress
    );

    let adminOwner = await proxyAdmin.owner();
    if (adminOwner !== upgradeManager.address) {
      expect(adminOwner).to.eq(owner);
      await proxyAdmin.transferOwnership(upgradeManager.address);
    }

    expect(await proxyAdmin.getProxyAdmin(instance.address)).to.equal(
      proxyAdmin.address
    );

    return instance;
  }

  it("can get version of contract", async () => {
    expect(await upgradeManager.cardpayVersion()).to.equal("1.0.0");
  });

  it("has a set of upgrade proposers", async () => {
    expect(await upgradeManager.getUpgradeProposers()).to.have.members([]);

    await expect(
      await upgradeManager.setup([upgradeProposer], versionManager.address)
    )
      .to.emit(upgradeManager, "Setup")
      .and.to.emit(upgradeManager, "ProposerAdded")
      .withArgs(upgradeProposer);

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      upgradeProposer,
    ]);

    await expect(await upgradeManager.removeUpgradeProposer(upgradeProposer))
      .to.emit(upgradeManager, "ProposerRemoved")
      .withArgs(upgradeProposer);

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([]);
  });

  it("allows adding a proposer");

  it("Can adopt a contract if it is the owner of the proxy admin", async () => {
    let instance = await deployV1();
    let proxyAdminAddress = await getAdminAddress(instance.address);

    await expect(
      upgradeManager.adoptProxy(
        "UpgradeableContractV1",
        instance.address,
        proxyAdminAddress
      )
    )
      .to.emit(upgradeManager, "ProxyAdopted")
      .withArgs("UpgradeableContractV1", instance.address);

    expect(await upgradeManager.contractIds(0)).to.eq("UpgradeableContractV1");
    await expect(upgradeManager.contractIds(1)).to.be.reverted;
    expect(await upgradeManager.getProxies()).to.have.members([
      instance.address,
    ]);
    expect(await upgradeManager.proxyAddresses("UpgradeableContractV1")).to.eq(
      instance.address
    );
  });

  it("allows manually setting the version");

  it.only("fails to adopt if it's not a proxy", async () => {
    let real = await deployV1();
    let proxyAdminAddress = await getAdminAddress(real.address);
    let instance = await UpgradeableContractV1.deploy();
    console.log("here");
    console.log("instance.address", instance.address);
    console.log("proxyAdminAddress", proxyAdminAddress);
    await expect(
      upgradeManager.adoptProxy(
        "UpgradeableContract",
        instance.address,
        proxyAdminAddress
      )
    ).to.be.rejectedWith("ProxyAdmin is not admin of this contract");
  });

  it("fails to adopt the contract if it is not the owner of the proxy admin", async () => {
    let instance = await deployV1();
    let proxyAdminAddress = await getAdminAddress(instance.address);
    await expect(
      upgradeManager.adoptProxy(
        "UpgradeableContractV1",
        instance.address,
        proxyAdminAddress
      )
    ).to.be.rejectedWith("Must be owner of ProxyAdmin to adopt");
  });

  it("fails to adopt if the proxy admin is not the right proxy admin for the contract being adopted", async () => {
    throw "todo";
    let instance = await deployV1();
    let proxyAdminAddress = await getAdminAddress(instance.address);
    await expect(
      upgradeManager.adoptProxy(
        "UpgradeableContractV1",
        instance.address,
        proxyAdminAddress
      )
    ).to.be.rejectedWith("Must be owner of ProxyAdmin to adopt");
  });
  it(
    "fails to adopt the contract if the contract is not owner by a proxy admin"
  );

  it("fails to adopt the contract if the contract id is already used");

  it("Can deploy a new proxy");

  it("allows a proposer to propose an upgrade", async () => {
    let instance = await deployV1();
    let proxyAdminAddress = await getAdminAddress(instance.address);

    await upgradeManager.adoptProxy(
      "UpgradeableContract",
      instance.address,
      proxyAdminAddress
    );

    let newImplementationAddress = await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    );

    await expect(
      upgradeManager.proposeUpgrade(
        "UpgradeableContract",
        newImplementationAddress
      )
    )
      .to.emit(upgradeManager, "UpgradeProposed")
      .withArgs("UpgradeableContract", newImplementationAddress);

    expect(await upgradeManager.pendingUpgrades(0)).to.eq(
      "UpgradeableContract"
    );
    await expect(upgradeManager.pendingUpgrades(1)).to.be.reverted;

    expect(await upgradeManager.upgradeAddresses(instance.address)).to.eq(
      newImplementationAddress
    );
  });
  it("upgrades a contract", async () => {
    let instance = await deployV1();
    let proxyAdminAddress = await getAdminAddress(instance.address);
    await upgradeManager.adoptProxy(
      "UpgradeableContract",
      instance.address,
      proxyAdminAddress
    );

    expect(await instance.version()).to.eq("1");

    let newImplementationAddress = await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    );

    await upgradeManager.proposeUpgrade(
      "UpgradeableContract",
      newImplementationAddress
    );

    expect(await instance.version()).to.eq("1");

    await upgradeManager.upgradeProtocol();

    expect(await instance.version()).to.eq("2");
  });
  it("emits an upgrade event for each contract upgraded");
  it("resets all state data eg for upandcall when upgrading");

  it("only allows owner to upgrade");
  it("updates the version and emits version update event on upgrade");
  it("allows retracting upgrade proposal");
  it("does not allow an upgrade proposal for an unregistered contract id");
  it("verifies proposed upgrade is a contract");
  it("does not allow non-proposers to propose an upgrade");
  it("lists the pending upgrade proposals");
  it(
    "verifies the proposed upgrade addresses are valid proxies with the right owners"
  );
  it(
    "performs the upgrades of all contracts in a single transaction and sets the protocol version"
  );
  it("minimizes string storage");
  it("allows calling transferOwnership");
  it("allows calling arbitrary setup functions");
  it("allows upgradeAndCall");
  it("resets all state data eg for upandcall when retracting");
  it("allows calling pause");
  it(
    "proxies upgrade proxy methods, https://blockscout.com/poa/sokol/address/0xBB6BaE445c8E43d929c0EE4C915c8ef002088D25/contracts"
  );
  it(
    "allows a large upgrade operation without using up too much gas in the transaction"
  );

  it("checks storage layout with prepareUpgrade");
  it(
    "allows freezing / approving a known good version for upgrade to prevent timing attacks"
  );
});
