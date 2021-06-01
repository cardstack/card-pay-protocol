const BridgeUtils = artifacts.require("BridgeUtils");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const GnosisFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisMaster = artifacts.require("GnosisSafe");
const ERC677Token = artifacts.require("ERC677Token.sol");

const utils = require("./utils/general");
const { setupExchanges } = require("./utils/helper");
const { expect } = require("./setup");
const { ZERO_ADDRESS } = utils;

contract("BridgeUtils", async (accounts) => {
  let bridgeUtils,
    pool,
    owner,
    gasFeeReceiver,
    merchantFeeReceiver,
    prepaidCardManager,
    tokenMock,
    unlistedToken,
    mediatorBridgeMock,
    wallet;
  before(async () => {
    owner = accounts[0];
    mediatorBridgeMock = accounts[1];
    gasFeeReceiver = accounts[6];
    merchantFeeReceiver = accounts[7];
    unlistedToken = await ERC677Token.new();
    await unlistedToken.initialize("Kitty Token", "KITTY", 18, owner);
    bridgeUtils = await BridgeUtils.new();
    await bridgeUtils.initialize(owner);
    pool = await RevenuePool.new();
    await pool.initialize(owner);
    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);

    let gnosisFactory = await GnosisFactory.new();
    let gnosisMaster = await GnosisMaster.new();

    let {
      daicpxdToken,
      chainlinkOracle,
      diaPriceOracle,
    } = await setupExchanges(owner);
    tokenMock = daicpxdToken.address;
    await pool.setup(
      prepaidCardManager.address,
      gnosisMaster.address,
      gnosisFactory.address,
      utils.Address0,
      [],
      merchantFeeReceiver,
      0,
      1000
    );
    await pool.createExchange("DAI", chainlinkOracle.address);
    await pool.createExchange("CARD", diaPriceOracle.address);

    const MINIMUM_AMOUNT = process.env.MINIMUM_AMOUNT ?? 100;
    const MAXIMUM_AMOUNT = process.env.MAXIMUM_AMOUNT ?? 100000 * 100;

    await prepaidCardManager.setup(
      gnosisMaster.address,
      gnosisFactory.address,
      pool.address,
      gasFeeReceiver,
      0,
      [],
      ZERO_ADDRESS,
      MINIMUM_AMOUNT,
      MAXIMUM_AMOUNT
    );

    await pool.setBridgeUtils(bridgeUtils.address);
    await prepaidCardManager.setBridgeUtils(bridgeUtils.address);

    await bridgeUtils.setup(
      pool.address,
      prepaidCardManager.address,
      gnosisMaster.address,
      gnosisFactory.address,
      mediatorBridgeMock
    );
  });

  it("can add new token to bridge", async () => {
    await bridgeUtils.addToken(tokenMock, { from: mediatorBridgeMock });

    let payableToken = await pool.getTokens();
    expect(payableToken.toString()).to.equal([tokenMock].toString());
  });

  it("rejects when a token is added that we do not have an exchange for", async () => {
    await bridgeUtils
      .addToken(unlistedToken.address, { from: mediatorBridgeMock })
      .should.be.rejectedWith(Error, "No exchange exists for token");
  });

  it("can get the BridgeUtils address", async () => {
    expect(await pool.bridgeUtils()).to.equal(bridgeUtils.address);
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
    let supplier = await bridgeUtils.suppliers(newSupplier);
    expect(supplier["registered"]).to.equal(true);
    expect(supplier["safe"]).to.equal(wallet);
    expect(await bridgeUtils.isRegistered(newSupplier)).to.equal(true);
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
    let supplierAddr = accounts[2];
    let gnosisSafe = await GnosisMaster.at(wallet);
    let payload = bridgeUtils.contract.methods
      .updateSupplier("Zion", "https://www.zion.com")
      .encodeABI();
    let signatures =
      "0x000000000000000000000000" +
      supplierAddr.replace("0x", "") +
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
      { from: supplierAddr }
    );

    let supplier = await bridgeUtils.suppliers(supplierAddr);

    expect(supplier["registered"]).to.equal(true);
    expect(supplier["safe"]).to.equal(wallet);
    expect(supplier["brandName"]).to.equal("Zion");
    expect(supplier["brandProfileUrl"]).to.equal("https://www.zion.com");
    expect(await bridgeUtils.safeForSupplier(supplierAddr)).to.equal(wallet);
  });

  it("rejects an update to a non-supplier address", async () => {
    let invalidSupplier = accounts[3];
    await bridgeUtils
      .updateSupplier("Babylon", "https://www.Babylon.com", {
        from: invalidSupplier,
      })
      .should.be.rejectedWith(Error, "Supplier is invalid");
  });
  it("can get version of contract", async () => {
    expect(await bridgeUtils.cardpayVersion()).to.match(/\d\.\d\.\d/);
  });
});
