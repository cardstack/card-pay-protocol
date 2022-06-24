import { Contract, ContractFactory } from "ethers";
import { contract, ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { setupVersionManager } from "./utils/helper";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const manifestPath = join(__dirname, "../.openzeppelin/unknown-31337.json");

const {
  deployProxy,
  prepareUpgrade,

  erc1967: { getAdminAddress },
} = upgrades;

contract.only("UpgradeManager", (accounts) => {
  let [owner, upgradeProposer, otherOwner] = accounts;

  let upgradeManager: Contract,
    versionManager: Contract,
    UpgradeableContractV1: ContractFactory,
    UpgradeableContractV2: ContractFactory;

  before(async () => {
    clearManifest();

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

  beforeEach(async () => {
    clearManifest();
  });

  async function deployV1({ from: from = owner } = {}): Promise<{
    proxyAdmin: Contract;
    instance: Contract;
  }> {
    let signer = await ethers.getSigner(from);

    let UpgradeableContractV1 = await ethers.getContractFactory(
      "UpgradeableContractV1",
      signer
    );

    let instance = await deployProxy(UpgradeableContractV1);
    let proxyAdminAddress = await getAdminAddress(instance.address);

    let proxyAdmin = await ethers.getContractAt(
      "IProxyAdmin",
      proxyAdminAddress
    );

    expect(await proxyAdmin.getProxyAdmin(instance.address)).to.equal(
      proxyAdmin.address
    );

    return { proxyAdmin, instance };
  }

  async function transferProxyAdminOwnership(
    proxyAdmin: Contract,
    newOwner: string
  ) {
    let adminOwner = await proxyAdmin.owner();
    if (adminOwner !== newOwner) {
      await proxyAdmin.transferOwnership(newOwner);
    }
  }

  async function deployAndAdoptContract(): Promise<{
    proxyAdmin: Contract;
    instance: Contract;
  }> {
    let { instance, proxyAdmin } = await deployV1();
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);

    await upgradeManager.adoptProxy(
      "UpgradeableContract",
      instance.address,
      proxyAdmin.address
    );

    return { instance, proxyAdmin };
  }

  function clearManifest() {
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath);
    }
  }

  it("can get version of contract", async () => {
    expect(await upgradeManager.cardpayVersion()).to.equal("1.0.0");
  });

  it("checks upgradability owner");

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
    let { instance, proxyAdmin } = await deployV1();
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);

    await expect(
      upgradeManager.adoptProxy(
        "UpgradeableContractV1",
        instance.address,
        proxyAdmin.address
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

  it("fails to adopt if it's not a proxy", async () => {
    let { proxyAdmin } = await deployV1();
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);

    let instance = await UpgradeableContractV1.deploy();

    await expect(
      upgradeManager.adoptProxy(
        "UpgradeableContract",
        instance.address,
        proxyAdmin.address
      )
    ).to.be.rejectedWith(
      "Call to determine proxy admin ownership of proxy failed"
    );
  });

  it("fails to adopt the contract if it is not the owner of the proxy admin", async () => {
    let { instance, proxyAdmin } = await deployV1({ from: otherOwner });

    await expect(
      upgradeManager.adoptProxy(
        "UpgradeableContractV1",
        instance.address,
        proxyAdmin.address
      )
    ).to.be.rejectedWith("Must be owner of ProxyAdmin to adopt");
  });
  it("checks admin() on proxy");

  it("fails to adopt if the proxy admin is not the right proxy admin for the contract being adopted", async () => {
    let { instance: instance1, proxyAdmin: proxyAdmin1 } = await deployV1({
      from: owner,
    });

    clearManifest();

    let { instance: instance2, proxyAdmin: proxyAdmin2 } = await deployV1({
      from: otherOwner,
    });

    expect(proxyAdmin1.address).not.to.eq(
      proxyAdmin2.address,
      "For this test there should be two different proxy admins"
    );

    await expect(
      upgradeManager.adoptProxy(
        "UpgradeableContractV1",
        instance1.address,
        proxyAdmin2.address
      )
    ).to.be.rejectedWith("Must be owner of ProxyAdmin to adopt");
  });
  it(
    "fails to adopt the contract if the contract is not owner by a proxy admin"
  );

  it("fails to adopt the contract if the contract id is already used");

  it("Can deploy a new proxy");

  it("allows a proposer to propose an upgrade", async () => {
    let { instance } = await deployAndAdoptContract();

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
    let { instance } = await deployAndAdoptContract();

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
