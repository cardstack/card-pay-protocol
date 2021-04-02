const BridgeUtils = artifacts.require("BridgeUtils");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const GnosisFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisMaster = artifacts.require("GnosisSafe");

const utils = require("./utils/general");

require("./setup");

contract("Bridge utils contract", async (accounts) => {
  let bridgeUtils, pool, prepaidCardManager;
  let mediatorBridgeMock, wallet;
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

  it("add new token to bridg" + "e", async () => {
    await bridgeUtils.updateToken(tokenMock, { from: mediatorBridgeMock });

    let payableToken = await pool.getTokens();

    assert.equal(payableToken.toString(), [tokenMock].toString());
  });

  it("register new supplier", async () => {
    let newSupplier = accounts[2];
    let summary = await bridgeUtils.registerSupplier(newSupplier, {
      from: mediatorBridgeMock,
    });

    wallet = summary.receipt.logs[0].args[1];
    let gnosisSafe = await GnosisMaster.at(wallet);

    let onwers = await gnosisSafe.getOwners();
    assert.equal(onwers.toString(), [newSupplier].toString());
    let supplier = await bridgeUtils.suppliers(wallet);
    assert.isTrue(supplier["registered"]);
  });

  it("try register supplier by non-mediator account", async () => {
    let newSupplier = accounts[2];
    let notMediatorOfBridge = accounts[3];
    await bridgeUtils
      .registerSupplier(newSupplier, {
        from: notMediatorOfBridge,
      })
      .should.be.rejectedWith(
        Error,
        "Guard: Action supported only by the bridge mediator"
      );
  });

  it("update supplier's profile - called by supplier ", async () => {
    let gnosisSafe = await GnosisMaster.at(wallet);
    let payload = bridgeUtils.contract.methods
      .updateSupplier("Zion", "https://www.zion.com")
      .encodeABI();
    let sigs =
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
      sigs,
      { from: accounts[2] }
    );

    let supplier = await bridgeUtils.suppliers(wallet);

    assert.isTrue(supplier["registered"]);
    assert.equal(supplier["brandName"], "Zion");
    assert.equal(supplier["brandProfileUrl"], "https://www.zion.com");
  });

  it("update invalid supplier", async () => {
    let invalidSupplier = accounts[3];
    await bridgeUtils
      .updateSupplier("Babylon", "https://www.Babylon.com", {
        from: invalidSupplier,
      })
      .should.be.rejectedWith(Error, "Supplier is invalid");
  });
});
