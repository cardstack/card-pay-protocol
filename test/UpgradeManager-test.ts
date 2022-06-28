import { Contract, ContractFactory } from "ethers";
import { contract, ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { setupVersionManager } from "./utils/helper";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { ZERO_ADDRESS } from "./migration/util";
// import ProxyAdmin from "@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol/ProxyAdmin.json";

const manifestPath = join(__dirname, "../.openzeppelin/unknown-31337.json");

const {
  deployProxy,
  prepareUpgrade,

  erc1967: { getAdminAddress },
} = upgrades;

contract.only("UpgradeManager", (accounts) => {
  let [owner, proposer, newProposer, randomEOA, otherOwner] = accounts;

  let upgradeManager: Contract,
    versionManager: Contract,
    UpgradeableContractV1: ContractFactory,
    UpgradeableContractV2: ContractFactory;
  // ProxyAdminFactory: ContractFactory;

  beforeEach(async () => {
    clearManifest();

    let UpgradeManager = await ethers.getContractFactory("UpgradeManager");
    UpgradeableContractV1 = await ethers.getContractFactory(
      "UpgradeableContractV1"
    );
    UpgradeableContractV2 = await ethers.getContractFactory(
      "UpgradeableContractV2"
    );

    versionManager = await ethers.getContractAt(
      "VersionManager",
      (
        await setupVersionManager(owner)
      ).address
    );

    upgradeManager = await UpgradeManager.deploy();
    await upgradeManager.initialize(owner);
    await upgradeManager.setup([proposer], versionManager.address);

    await versionManager.transferOwnership(upgradeManager.address);
  });

  async function deployV1({
    from = owner,
    contract = "UpgradeableContractV1",
  } = {}): Promise<{
    proxyAdmin: Contract;
    instance: Contract;
  }> {
    let signer = await ethers.getSigner(from);

    let UpgradeableContractV1 = await ethers.getContractFactory(
      contract,
      signer
    );

    let instance = await deployProxy(UpgradeableContractV1, [owner]);
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

  async function asAdminUpgradeabilityProxy(contract: Contract) {
    return ethers.getContractAt("IAdminUpgradeabilityProxy", contract.address);
  }

  async function deployAndAdoptContract({
    id = "UpgradeableContract",
    contract = "UpgradeableContractV1",
  } = {}): Promise<{
    proxyAdmin: Contract;
    instance: Contract;
  }> {
    let { instance, proxyAdmin } = await deployV1({ contract });
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);
    await instance.transferOwnership(upgradeManager.address);

    await upgradeManager.adoptProxy(id, instance.address, proxyAdmin.address);

    return { instance, proxyAdmin };
  }

  function clearManifest() {
    if (existsSync(manifestPath)) {
      unlinkSync(manifestPath);
    }
  }

  function encodeWithSignature(signature: string, ...args: unknown[]) {
    let iface = new ethers.utils.Interface([`function ${signature}`]);
    return iface.encodeFunctionData(signature, args);
  }

  async function contractWithSigner(contract: Contract, signer: string) {
    return contract.connect(await ethers.getSigner(signer));
  }

  it("can get version of contract", async () => {
    expect(await upgradeManager.cardpayVersion()).to.equal("1.0.0");
  });

  it("has a set of upgrade proposers", async () => {
    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      proposer,
    ]);

    await expect(
      await upgradeManager.setup(
        [proposer, newProposer],
        versionManager.address
      )
    )
      .to.emit(upgradeManager, "Setup")
      .and.to.emit(upgradeManager, "ProposerAdded")
      .withArgs(newProposer);

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      proposer,
      newProposer,
    ]);

    await expect(await upgradeManager.removeUpgradeProposer(proposer))
      .to.emit(upgradeManager, "ProposerRemoved")
      .withArgs(proposer);

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      newProposer,
    ]);

    await expect(await upgradeManager.addUpgradeProposer(randomEOA)).to.emit(
      upgradeManager,
      "ProposerAdded"
    );

    expect(await upgradeManager.getUpgradeProposers()).to.have.members([
      randomEOA,
      newProposer,
    ]);
  });

  it("Can adopt a contract if it is the owner of the proxy admin and the proxy", async () => {
    let { instance, proxyAdmin } = await deployV1();
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);
    await instance.transferOwnership(upgradeManager.address);

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

  it("fails to adopt if it's not a proxy", async () => {
    let { proxyAdmin } = await deployV1();
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);

    let instance = await UpgradeableContractV1.deploy();
    await instance.initialize(upgradeManager.address);

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

  it("fails to adopt the contract if it is not the owner of the contract", async () => {
    let { instance, proxyAdmin } = await deployV1();
    await transferProxyAdminOwnership(proxyAdmin, upgradeManager.address);

    await expect(
      upgradeManager.adoptProxy(
        "UpgradeableContractV1",
        instance.address,
        proxyAdmin.address
      )
    ).to.be.rejectedWith("Must be owner of contract to adopt");
  });

  it("fails to adopt if the proxy admin is not the right proxy admin for the contract being adopted", async () => {
    let { instance: instance1, proxyAdmin: proxyAdmin1 } = await deployV1({
      from: owner,
    });

    clearManifest();

    let { proxyAdmin: proxyAdmin2 } = await deployV1({
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

  it("fails to adopt the contract if the contract id is already used", async () => {
    await deployAndAdoptContract({
      id: "Collision",
    });
    await expect(
      deployAndAdoptContract({
        id: "Collision",
      })
    ).to.be.rejectedWith("Contract id already registered");
  });

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
      .to.emit(upgradeManager, "ChangesProposed")
      .withArgs("UpgradeableContract", newImplementationAddress, "0x");

    expect(await upgradeManager.getPendingChanges()).to.eql([instance.address]);

    expect(await upgradeManager.upgradeAddresses(instance.address)).to.eq(
      newImplementationAddress
    );
  });
  it("upgrades a contract", async () => {
    let { instance } = await deployAndAdoptContract();

    expect(await instance.version()).to.eq("1");
    expect(await versionManager.version()).to.eq("1.0.0");

    let newImplementationAddress = await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    );

    await upgradeManager.proposeUpgrade(
      "UpgradeableContract",
      newImplementationAddress
    );

    expect(await instance.version()).to.eq("1");
    expect(await versionManager.version()).to.eq("1.0.0");

    await expect(upgradeManager.upgradeProtocol("1.0.1"))
      .to.emit(versionManager, "VersionUpdate")
      .withArgs("1.0.1");

    expect(await instance.version()).to.eq("2");
    expect(await versionManager.version()).to.eq("1.0.1");
  });

  it("upgrades multiple contracts atomically", async () => {
    let { instance: instance1, proxyAdmin: proxyAdmin1 } =
      await deployAndAdoptContract({
        id: "ContractA",
      });
    let { instance: instance2, proxyAdmin: proxyAdmin2 } =
      await deployAndAdoptContract({
        id: "ContractB",
      });

    expect(await instance1.version()).to.eq("1");
    expect(await instance2.version()).to.eq("1");
    expect(proxyAdmin1.address).to.eq(proxyAdmin2.address);

    let newImplementationAddress1 = await prepareUpgrade(
      instance1.address,
      UpgradeableContractV2
    );
    let newImplementationAddress2 = await prepareUpgrade(
      instance2.address,
      UpgradeableContractV2
    );

    expect(newImplementationAddress1).to.eq(newImplementationAddress2);

    await upgradeManager.proposeUpgrade("ContractA", newImplementationAddress1);
    await upgradeManager.proposeUpgrade("ContractB", newImplementationAddress1);

    expect(await instance1.version()).to.eq("1");
    expect(await instance2.version()).to.eq("1");

    expect(await upgradeManager.getPendingChanges()).to.eql([
      instance1.address,
      instance2.address,
    ]);

    await expect(upgradeManager.upgradeProtocol("1.0.1"))
      .to.emit(await asAdminUpgradeabilityProxy(instance1), "Upgraded")
      .withArgs(newImplementationAddress1)
      .and.to.emit(await asAdminUpgradeabilityProxy(instance2), "Upgraded")
      .withArgs(newImplementationAddress1);

    expect(await instance1.version()).to.eq("2");
    expect(await instance2.version()).to.eq("2");
  });

  it("only allows owner to upgrade", async () => {
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

    upgradeManager = await contractWithSigner(upgradeManager, randomEOA);

    await expect(
      upgradeManager.upgradeProtocol("1.0.1", { from: randomEOA })
    ).to.be.rejectedWith("Ownable: caller is not the owner");

    expect(await instance.version()).to.eq("1");
  });

  it("allows retracting change proposals", async () => {
    let { instance: instance1 } = await deployAndAdoptContract({ id: "C1" });
    let { instance: instance2 } = await deployAndAdoptContract({ id: "C2" });
    let { instance: instance3 } = await deployAndAdoptContract({
      id: "C3",
      contract: "UpgradeableContractV2",
    });

    await upgradeManager.proposeUpgrade(
      "C1",
      await prepareUpgrade(instance1.address, UpgradeableContractV2)
    );

    await upgradeManager.proposeUpgradeAndCall(
      "C2",
      await prepareUpgrade(instance2.address, UpgradeableContractV2),
      encodeWithSignature("setup(string)", "bar")
    );

    await upgradeManager.proposeCall(
      "C3",
      encodeWithSignature("setup(string)", "baz")
    );

    // only proposers can withdraw changes
    await expect(upgradeManager.withdrawChanges("C1")).to.be.rejectedWith(
      "Caller is not proposer"
    );

    let upgradeManagerAsProposer = await contractWithSigner(
      upgradeManager,
      proposer
    );
    await upgradeManagerAsProposer.withdrawChanges("C1", { from: proposer });
    await upgradeManagerAsProposer.withdrawChanges("C2", { from: proposer });
    await upgradeManagerAsProposer.withdrawChanges("C3", { from: proposer });

    expect(await upgradeManager.encodedCallData(instance1.address)).to.eq("0x");
    expect(await upgradeManager.encodedCallData(instance2.address)).to.eq("0x");
    expect(await upgradeManager.encodedCallData(instance3.address)).to.eq("0x");
    expect(await upgradeManager.upgradeAddresses(instance1.address)).to.eq(
      ZERO_ADDRESS
    );
    expect(await upgradeManager.upgradeAddresses(instance2.address)).to.eq(
      ZERO_ADDRESS
    );
    expect(await upgradeManager.upgradeAddresses(instance3.address)).to.eq(
      ZERO_ADDRESS
    );
    expect(await upgradeManager.getPendingChanges()).to.eql([]);
  });
  it("gets contract id from proxy address");
  it("only proposers can withdraw");
  it("reverts on empty changes");
  it("does not allow an upgrade proposal for an unregistered contract id");
  it("verifies proposed upgrade is a contract");
  it("does not allow non-proposers to propose an upgrade");
  it("lists the pending upgrade proposals");
  it("lists pending calls");
  it("only allows proposers or owner to propose upgrades / upgrades and calls");
  it("only allows owners to call");
  it("only allows owner to upgrade");
  it("audit access control");
  it(
    "verifies the proposed upgrade addresses are valid proxies with the right owners"
  );
  it(
    "performs the upgrades of all contracts in a single transaction and sets the protocol version"
  );
  it("minimizes string storage");
  it("allows calling transferOwnership");
  it("prevents owning itself");
  it("handles call errors");
  it("allows calling arbitrary functions as owner", async () => {
    let { instance } = await deployAndAdoptContract({
      contract: "UpgradeableContractV2",
    });

    expect(await instance.foo()).to.eq("");
    let encodedCallData = encodeWithSignature("setup(string)", "bar");
    await upgradeManager.call("UpgradeableContract", encodedCallData);
    expect(await instance.foo()).to.eq("bar");
  });

  it("allows upgradeAndCall", async () => {
    let { instance } = await deployAndAdoptContract();

    let instanceV2 = UpgradeableContractV2.attach(instance.address);

    expect(await instance.version()).to.eq("1");
    await expect(instanceV2.foo()).to.be.rejected;
    let newImplementationAddress = await prepareUpgrade(
      instance.address,
      UpgradeableContractV2
    );
    let encodedCallData = encodeWithSignature("setup(string)", "bar");
    await upgradeManager.proposeUpgradeAndCall(
      "UpgradeableContract",
      newImplementationAddress,
      encodedCallData
    );

    expect(await upgradeManager.encodedCallData(instance.address)).to.eq(
      encodedCallData
    );
    await expect(instanceV2.foo()).to.be.rejected;
    await upgradeManager.upgradeProtocol("1.0.1");
    expect(await instanceV2.version()).to.eq("2");
    expect(await instanceV2.foo()).to.eq("bar");
    expect(await upgradeManager.encodedCallData(instance.address)).to.eq("0x");
  });

  it("Allows a combination of upgrade, call, and upgradeAndCall in the same batched operation", async () => {
    let { instance: instance1 } = await deployAndAdoptContract({ id: "C1" });
    let { instance: instance2 } = await deployAndAdoptContract({ id: "C2" });
    let { instance: instance3 } = await deployAndAdoptContract({
      id: "C3",
      contract: "UpgradeableContractV2",
    });

    await upgradeManager.proposeUpgrade(
      "C1",
      await prepareUpgrade(instance1.address, UpgradeableContractV2)
    );

    await upgradeManager.proposeUpgradeAndCall(
      "C2",
      await prepareUpgrade(instance2.address, UpgradeableContractV2),
      encodeWithSignature("setup(string)", "bar")
    );

    await upgradeManager.proposeCall(
      "C3",
      encodeWithSignature("setup(string)", "baz")
    );

    let instance1AsV2 = await ethers.getContractAt(
      "UpgradeableContractV2",
      instance1.address
    );
    let instance2AsV2 = await ethers.getContractAt(
      "UpgradeableContractV2",
      instance2.address
    );

    expect(await instance1.version()).to.eq("1");
    await expect(instance1AsV2.foo()).to.be.rejectedWith(
      "function selector was not recognized"
    );

    expect(await instance2.version()).to.eq("1");
    await expect(instance2AsV2.foo()).to.be.rejectedWith(
      "function selector was not recognized"
    );

    expect(await instance3.version()).to.eq("2");
    expect(await instance3.foo()).to.eq("");

    expect(await upgradeManager.getPendingChanges()).to.eql([
      instance1.address,
      instance2.address,
      instance3.address,
    ]);

    await upgradeManager.upgradeProtocol("1.0.1");

    expect(await instance1.version()).to.eq("2");
    expect(await instance1AsV2.foo()).to.eq("");

    expect(await instance2.version()).to.eq("2");
    expect(await instance2AsV2.foo()).to.eq("bar");

    expect(await instance3.version()).to.eq("2");
    expect(await instance3.foo()).to.eq("baz");

    expect(await upgradeManager.encodedCallData(instance1.address)).to.eq("0x");
    expect(await upgradeManager.encodedCallData(instance2.address)).to.eq("0x");
    expect(await upgradeManager.encodedCallData(instance3.address)).to.eq("0x");
    expect(await upgradeManager.upgradeAddresses(instance1.address)).to.eq(
      ZERO_ADDRESS
    );
    expect(await upgradeManager.upgradeAddresses(instance2.address)).to.eq(
      ZERO_ADDRESS
    );
    expect(await upgradeManager.upgradeAddresses(instance3.address)).to.eq(
      ZERO_ADDRESS
    );
    expect(await upgradeManager.getPendingChanges()).to.eql([]);
  });

  it("stores pendingChanges as address array not string array");

  it("handles proposing when already proposed");
  it("resets all state data eg for upandcall when retracting");
  it("allows calling pause");
  it("doesn't upgrade if address unchanged");
  it("verifies new impl is contract");
  it(
    "proxies upgrade proxy methods, https://blockscout.com/poa/sokol/address/0xBB6BaE445c8E43d929c0EE4C915c8ef002088D25/contracts"
  );

  it("rejects upgrade / upgradeAndCall if implementation address is unchanged");

  it("fails if no upgrades are proposed");
  it("handles interplay of upgrade and config");
  it("has a nonce");
  it("nonce is incremented for all config / upgrade / retraction etc");
  it("checks propsed upgradeAndCall with staticcall");
  it(
    "allows a large upgrade operation without using up too much gas in the transaction"
  );

  it("checks storage layout with prepareUpgrade");
  it(
    "allows freezing / approving a known good version for upgrade to prevent timing attacks"
  );

  it(
    "handles overwrite when calling upgradeAndCall then normal upgrade so the call data is removed"
  );

  it("allows cancelling an proposed upgrade and a proposed upgradeandcall");
  it("doesn't allow self adoption?");

  describe("Cleanup", () => {
    it("orders functions in contract by visibility");
  });

  // describe("Future", function () {
  //   it("has meaningful version storage not string");
  //   it("has support for pausing all contracts that support pause")
  // });
});
