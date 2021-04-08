const BridgeUtils = artifacts.require("BridgeUtils");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const GnosisFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisMaster = artifacts.require("GnosisSafe");

const utils = require("./utils/general");

const { expect } = require("./setup");

contract("BridgeUtils", async (accounts) => {
  let bridgeUtils,
    pool,
    prepaidCardManager,
    tokenMock,
    mediatorBridgeMock,
    wallet;
  before(async () => {
    let tallyAdmin = accounts[0];
    mediatorBridgeMock = accounts[1];
    tokenMock = accounts[2];
    bridgeUtils = await BridgeUtils.new(tallyAdmin);
    pool = await RevenuePool.new();

    let gnosisFactory = await GnosisFactory.new();
    let gnosisMaster = await GnosisMaster.new();

    await pool.setup(
      tallyAdmin,
      gnosisMaster.address,
      gnosisFactory.address,
      utils.Address0,
      []
    );

    prepaidCardManager = await PrepaidCardManager.new();

    const MINIMUM_AMOUNT = process.env.MINIMUM_AMOUNT ?? 100;
    const MAXIMUM_AMOUNT = process.env.MAXIMUM_AMOUNT ?? 100000 * 100;

    await prepaidCardManager.setup(
      tallyAdmin,
      gnosisMaster.address,
      gnosisFactory.address,
      pool.address,
      [],
      MINIMUM_AMOUNT,
      MAXIMUM_AMOUNT
    );

    await bridgeUtils.setup(
      pool.address,
      prepaidCardManager.address,
      gnosisMaster.address,
      gnosisFactory.address,
      mediatorBridgeMock
    );
  });

  it("can add new token to bridge", async () => {
    await bridgeUtils.updateToken(tokenMock, { from: mediatorBridgeMock });

    let payableToken = await pool.getTokens();
    expect(payableToken.toString()).to.equal([tokenMock].toString());
  });

  it("can register new supplier", async () => {
    let newSupplier = accounts[2];
    let summary = await bridgeUtils.registerSupplier(newSupplier, {
      from: mediatorBridgeMock,
    });

    wallet = summary.receipt.logs[0].args[1];
    let gnosisSafe = await GnosisMaster.at(wallet);

    let owners = await gnosisSafe.getOwners();
    expect(owners.toString()).to.equal([newSupplier].toString());
    let supplier = await bridgeUtils.suppliers(wallet);
    expect(supplier["registered"]).to.equal(true);
    expect(await bridgeUtils.isRegistered(wallet)).to.equal(true);
  });

  it("rejects a supplier registration from a non-mediator address", async () => {
    let newSupplier = accounts[2];
    let notMediatorOfBridge = accounts[3];
    await bridgeUtils
      .registerSupplier(newSupplier, {
        from: notMediatorOfBridge,
      })
      .should.be.rejectedWith(Error, "caller is not a bridge mediator");
  });

  it("allows a supplier to update their profile", async () => {
    let gnosisSafe = await GnosisMaster.at(wallet);
    let payload = bridgeUtils.contract.methods
      .updateSupplier("Zion", "https://www.zion.com")
      .encodeABI();
    let signatures =
      "0x000000000000000000000000" +
      accounts[2].replace("0x", "") +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "01";

    await gnosisSafe.execTransaction(
      bridgeUtils.address,
      0,
      payload,
      0,
      0,
      0,
      0,
      utils.ZERO_ADDRESS,
      utils.ZERO_ADDRESS,
      signatures,
      { from: accounts[2] }
    );

    let supplier = await bridgeUtils.suppliers(wallet);

    expect(supplier["registered"]).to.equal(true);
    expect(supplier["brandName"]).to.equal("Zion");
    expect(supplier["brandProfileUrl"]).to.equal("https://www.zion.com");
  });

  it("rejects an update to a non-supplier address", async () => {
    let invalidSupplier = accounts[3];
    await bridgeUtils
      .updateSupplier("Babylon", "https://www.Babylon.com", {
        from: invalidSupplier,
      })
      .should.be.rejectedWith(Error, "Supplier is invalid");
  });
});
