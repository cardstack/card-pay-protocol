const BridgeUtils = artifacts.require("BridgeUtils");
const GnosisFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const ERC677Token = artifacts.require("ERC677Token.sol");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");

const eventABIs = require("./utils/constant/eventABIs");
const utils = require("./utils/general");
const {
  setupExchanges,
  signAndSendSafeTransaction,
  toTokenUnit,
  setupVersionManager,
} = require("./utils/helper");
const { expect } = require("./setup");

contract("BridgeUtils", async (accounts) => {
  let bridgeUtils,
    owner,
    tokenMock,
    unlistedToken,
    mediatorBridgeMock,
    daicpxdToken,
    relayer,
    tokenManager,
    supplierManager,
    versionManager,
    exchange,
    depot;
  before(async () => {
    owner = accounts[0];
    mediatorBridgeMock = accounts[1];
    relayer = accounts[8];

    versionManager = await setupVersionManager(owner);
    unlistedToken = await ERC677Token.new();
    await unlistedToken.initialize("Kitty Token", "KITTY", 18, owner);
    bridgeUtils = await BridgeUtils.new();
    await bridgeUtils.initialize(owner);
    tokenManager = await TokenManager.new();
    await tokenManager.initialize(owner);
    supplierManager = await SupplierManager.new();
    await supplierManager.initialize(owner);
    let actionDispatcher = await ActionDispatcher.new();
    await actionDispatcher.initialize(owner);

    let gnosisFactory = await GnosisFactory.new();
    let gnosisMaster = await GnosisSafe.new();

    ({ daicpxdToken, exchange } = await setupExchanges(owner));
    tokenMock = daicpxdToken.address;
    await tokenManager.setup(bridgeUtils.address, [], versionManager.address);

    await supplierManager.setup(
      bridgeUtils.address,
      gnosisMaster.address,
      gnosisFactory.address,
      versionManager.address
    );

    await bridgeUtils.setup(
      tokenManager.address,
      supplierManager.address,
      exchange.address,
      mediatorBridgeMock,
      versionManager.address
    );
  });

  it("can add new token to bridge", async () => {
    await bridgeUtils.addToken(tokenMock, { from: mediatorBridgeMock });

    let payableToken = await tokenManager.getTokens();
    expect(payableToken.toString()).to.equal([tokenMock].toString());
  });

  it("rejects when a token is added that we do not have an exchange for", async () => {
    await bridgeUtils
      .addToken(unlistedToken.address, { from: mediatorBridgeMock })
      .should.be.rejectedWith(Error, "No exchange exists for token");
  });

  it("can add and remove a payable token", async () => {
    let tokenMock2 = accounts[9];

    await tokenManager.addPayableToken(tokenMock2).should.be.fulfilled;

    await tokenManager.removePayableToken(tokenMock).should.be.fulfilled;

    await tokenManager.getTokens().should.become([tokenMock2]);
  });

  it("non-owner cannot add payable token", async () => {
    let mockPayableTokenAddr = accounts[9];
    await tokenManager
      .addPayableToken(mockPayableTokenAddr, { from: accounts[2] })
      .should.be.rejectedWith(Error, "caller is not BridgeUtils");
  });

  it("bridge mediator can register new supplier", async () => {
    let newSupplier = accounts[2];
    let tx = await bridgeUtils.registerSupplier(newSupplier, {
      from: mediatorBridgeMock,
    });

    let eventParams = utils.getParamsFromEvent(
      tx,
      eventABIs.SUPPLIER_SAFE_CREATED,
      supplierManager.address
    );
    depot = eventParams[0].safe; // warning this depot is used in other tests
    let gnosisSafe = await GnosisSafe.at(depot);

    let owners = await gnosisSafe.getOwners();
    expect(owners.toString()).to.equal([newSupplier].toString());
    let supplier = await supplierManager.suppliers(newSupplier);
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

  it("owner can register new supplier from SupplierManager", async () => {
    let newSupplier = accounts[4];
    let tx = await supplierManager.registerSupplier(newSupplier, {
      from: owner,
    });
    let eventParams = utils.getParamsFromEvent(
      tx,
      eventABIs.SUPPLIER_SAFE_CREATED,
      supplierManager.address
    );
    let depot = eventParams[0].safe;
    let gnosisSafe = await GnosisSafe.at(depot);

    let owners = await gnosisSafe.getOwners();
    expect(owners.toString()).to.equal([newSupplier].toString());
    let supplier = await supplierManager.suppliers(newSupplier);
    expect(supplier["registered"]).to.equal(true);
    expect(supplier["safe"]).to.equal(depot);
    expect(await bridgeUtils.isRegistered(newSupplier)).to.equal(true);
  });

  it("rejects a supplier registration from a non-owner/non-bridge utils address in SupplierManager", async () => {
    let newSupplier = accounts[2];
    let notAllowed = accounts[3];
    await supplierManager
      .registerSupplier(newSupplier, {
        from: notAllowed,
      })
      .should.be.rejectedWith(Error, "caller is not BridgeUtils nor owner");
  });

  it("allows a supplier to set an infoDID", async () => {
    await daicpxdToken.mint(depot, toTokenUnit(1)); // mint tokens for gas payment
    let supplierAddr = accounts[2];
    let setInfoDID = supplierManager.contract.methods.setSupplierInfoDID(
      "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
    );
    let payload = setInfoDID.encodeABI();
    let gasEstimate = await setInfoDID.estimateGas({ from: depot });
    let safeTxData = {
      to: supplierManager.address,
      data: payload,
      txGasEstimate: gasEstimate,
      gasPrice: 1000000000,
      txGasToken: daicpxdToken.address,
      refundReceiver: relayer,
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

    let supplier = await supplierManager.suppliers(supplierAddr);
    expect(supplier["registered"]).to.equal(true);
    expect(supplier["safe"]).to.equal(depot);
    expect(supplier["infoDID"]).to.equal(
      "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49"
    );
    expect(await supplierManager.safeForSupplier(supplierAddr)).to.equal(depot);
    expect(await bridgeUtils.safeForSupplier(supplierAddr)).to.equal(depot);
  });

  it("rejects an infoDID update from a non-depot address", async () => {
    let invalidSupplier = accounts[3];
    await supplierManager
      .setSupplierInfoDID(
        "did:cardstack:56d6fc54-d399-443b-8778-d7e4512d3a49",
        {
          from: invalidSupplier,
        }
      )
      .should.be.rejectedWith(Error, "caller is not a supplier safe");
  });

  it("returns a zero address when you ask for the safe of a supplier that does not exist", async () => {
    expect(await supplierManager.safeForSupplier(accounts[9])).to.equal(
      utils.ZERO_ADDRESS
    );
  });

  it("can get version of contract", async () => {
    expect(await tokenManager.cardpayVersion()).to.equal("1.0.0");
    expect(await bridgeUtils.cardpayVersion()).to.equal("1.0.0");
    expect(await supplierManager.cardpayVersion()).to.equal("1.0.0");
  });
});

contract("BridgeUtils", async (accounts) => {
  let bridgeUtils,
    owner,
    unlistedToken,
    mediatorBridgeMock,
    tokenManager,
    supplierManager,
    versionManager,
    exchange,
    _daicpxdToken;
  before(async () => {
    owner = accounts[0];
    mediatorBridgeMock = accounts[1];

    versionManager = await setupVersionManager(owner);
    unlistedToken = await ERC677Token.new();
    await unlistedToken.initialize("Kitty Token", "KITTY", 18, owner);
    bridgeUtils = await BridgeUtils.new();
    await bridgeUtils.initialize(owner);
    tokenManager = await TokenManager.new();
    await tokenManager.initialize(owner);
    supplierManager = await SupplierManager.new();
    await supplierManager.initialize(owner);
    let actionDispatcher = await ActionDispatcher.new();
    await actionDispatcher.initialize(owner);

    let gnosisFactory = await GnosisFactory.new();
    let gnosisMaster = await GnosisSafe.new();

    ({ _daicpxdToken, exchange } = await setupExchanges(owner)); // eslint-disable-line @typescript-eslint/no-unused-vars

    await tokenManager.setup(bridgeUtils.address, [], versionManager.address);

    await supplierManager.setup(
      bridgeUtils.address,
      gnosisMaster.address,
      gnosisFactory.address,
      versionManager.address
    );

    await bridgeUtils.setup(
      tokenManager.address,
      supplierManager.address,
      exchange.address,
      mediatorBridgeMock,
      versionManager.address
    );
  });

  it("Returns the original depot if you register twice", async () => {
    let newSupplier = accounts[6];
    let txFirstRegister = await bridgeUtils.registerSupplier(newSupplier, {
      from: mediatorBridgeMock,
    });

    let eventParamsFirstRegister = utils.getParamsFromEvent(
      txFirstRegister,
      eventABIs.SUPPLIER_SAFE_CREATED,
      supplierManager.address
    );
    let depotFirstRegister = eventParamsFirstRegister[0].safe;

    let txSecondRegister = await bridgeUtils.registerSupplier(newSupplier, {
      from: mediatorBridgeMock,
    });

    let eventParamsSecondRegister = utils.getParamsFromEvent(
      txSecondRegister,
      eventABIs.SUPPLIER_SAFE_CREATED,
      supplierManager.address
    );
    let depotSecondRegister = eventParamsSecondRegister[0].safe;

    expect(depotFirstRegister).to.equal(depotSecondRegister);
    expect(await bridgeUtils.isRegistered(newSupplier)).to.equal(true);
  });
});
