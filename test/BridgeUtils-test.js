const BridgeUtils = artifacts.require("BridgeUtils");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool");
const GnosisFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const ERC677Token = artifacts.require("ERC677Token.sol");
const RewardPool = artifacts.require("RewardPool.sol");

const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");
const {
  setupExchanges,
  signAndSendSafeTransaction,
  toTokenUnit,
} = require("./utils/helper");
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
    daicpxdToken,
    relayer,
    depot,
    rewardPool;
  before(async () => {
    owner = accounts[0];
    mediatorBridgeMock = accounts[1];
    gasFeeReceiver = accounts[6];
    merchantFeeReceiver = accounts[7];
    relayer = accounts[8];
    unlistedToken = await ERC677Token.new();
    await unlistedToken.initialize("Kitty Token", "KITTY", 18, owner);
    bridgeUtils = await BridgeUtils.new();
    await bridgeUtils.initialize(owner);
    pool = await RevenuePool.new();
    await pool.initialize(owner);
    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);
    rewardPool = await RewardPool.new();
    await rewardPool.initialize(owner);

    let gnosisFactory = await GnosisFactory.new();
    let gnosisMaster = await GnosisSafe.new();

    let chainlinkOracle, diaPriceOracle;
    ({ daicpxdToken, chainlinkOracle, diaPriceOracle } = await setupExchanges(
      owner
    ));
    tokenMock = daicpxdToken.address;
    await pool.setup(
      prepaidCardManager.address,
      gnosisMaster.address,
      gnosisFactory.address,
      utils.Address0,
      [],
      merchantFeeReceiver,
      0,
      1000,
      1000000
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
    await rewardPool.setBridgeUtils(bridgeUtils.address);

    await bridgeUtils.setup(
      pool.address,
      prepaidCardManager.address,
      gnosisMaster.address,
      gnosisFactory.address,
      mediatorBridgeMock,
      rewardPool.address
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

    depot = summary.receipt.logs[0].args[1];
    let gnosisSafe = await GnosisSafe.at(depot);

    let owners = await gnosisSafe.getOwners();
    expect(owners.toString()).to.equal([newSupplier].toString());
    let supplier = await bridgeUtils.suppliers(newSupplier);
    expect(supplier["registered"]).to.equal(true);
    expect(supplier["safe"]).to.equal(depot);
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

  it("allows a supplier to set an infoDID", async () => {
    await daicpxdToken.mint(depot, toTokenUnit(1)); // mint tokens for gas payment
    let supplierAddr = accounts[2];
    let setInfoDID = bridgeUtils.contract.methods.setSupplierInfoDID(
      "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
    );
    let payload = setInfoDID.encodeABI();
    let gasEstimate = await setInfoDID.estimateGas({ from: depot });
    let safeTxData = {
      to: bridgeUtils.address,
      data: payload,
      txGasEstimate: gasEstimate,
      gasPrice: 1000000000,
      txGasToken: daicpxdToken.address,
      refundReceive: relayer,
    };
    let depotContract = await GnosisSafe.at(depot);
    let { safeTx } = await signAndSendSafeTransaction(
      safeTxData,
      supplierAddr,
      depotContract,
      relayer
    );
    let executeSuccess = utils.getParamsFromEvent(
      safeTx,
      eventABIs.EXECUTION_SUCCESS,
      depot
    );
    expect(executeSuccess.length).to.equal(1);

    let supplier = await bridgeUtils.suppliers(supplierAddr);
    expect(supplier["registered"]).to.equal(true);
    expect(supplier["safe"]).to.equal(depot);
    expect(supplier["infoDID"]).to.equal(
      "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
    );
    expect(await bridgeUtils.safeForSupplier(supplierAddr)).to.equal(depot);
  });

  it("rejects an infoDID update from a non-depot address", async () => {
    let invalidSupplier = accounts[3];
    await bridgeUtils
      .setSupplierInfoDID(
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49",
        {
          from: invalidSupplier,
        }
      )
      .should.be.rejectedWith(Error, "caller is not a supplier safe");
  });
  it("can get version of contract", async () => {
    expect(await bridgeUtils.cardpayVersion()).to.match(/\d\.\d\.\d/);
  });
});
