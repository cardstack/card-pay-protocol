const ERC677Token = artifacts.require("ERC677Token.sol");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const PrepaidCardMarket = artifacts.require("PrepaidCardMarket");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const AbiCoder = require("web3-eth-abi");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");

const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");

const { ZERO_ADDRESS, getParamsFromEvent, signSafeTransaction } = utils;
const { expect, TOKEN_DETAIL_DATA } = require("./setup");
const { BN, fromWei, toBN, toWei } = require("web3").utils;

const {
  toTokenUnit,
  shouldBeSameBalance,
  getBalance,
  signAndSendSafeTransaction,
  setupExchanges,
  createPrepaidCards,
  transferOwner,
  addActionHandlers,
  createDepotFromSupplierMgr,
} = require("./utils/helper");

contract("PrepaidCardMarket", (accounts) => {
  let daicpxdToken,
    cardcpxdToken,
    issuer,
    owner,
    relayer,
    actionDispatcher,
    customer,
    proxyFactory,
    gnosisSafeMasterCopy,
    prepaidCardManager,
    prepaidCardMarket,
    depot;

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    customer = accounts[3];
    relayer = accounts[5];

    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await utils.deployContract(
      "deploying Gnosis Safe Mastercopy",
      GnosisSafe
    );

    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);
    prepaidCardMarket = await PrepaidCardMarket.new();
    await prepaidCardMarket.initialize(owner);
    let supplierManager = await SupplierManager.new();
    await supplierManager.initialize(owner);
    actionDispatcher = await ActionDispatcher.new();
    await actionDispatcher.initialize(owner);
    let tokenManager = await TokenManager.new();
    await tokenManager.initialize(owner);

    let exchange;
    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));

    await daicpxdToken.mint(owner, toTokenUnit(100));

    await tokenManager.setup(ZERO_ADDRESS, [
      daicpxdToken.address,
      cardcpxdToken.address,
    ]);

    await supplierManager.setup(
      ZERO_ADDRESS,
      gnosisSafeMasterCopy.address,
      proxyFactory.address
    );
    await prepaidCardManager.setup(
      tokenManager.address,
      supplierManager.address,
      exchange.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      actionDispatcher.address,
      ZERO_ADDRESS,
      0,
      cardcpxdToken.address,
      100,
      500000,
      [prepaidCardMarket.address]
    );
    await prepaidCardManager.addGasPolicy("transfer", false, true);
    await prepaidCardManager.addGasPolicy("split", true, true);

    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address
    );

    await addActionHandlers({
      prepaidCardManager,
      actionDispatcher,
      tokenManager,
      owner,
    });

    depot = await createDepotFromSupplierMgr(supplierManager, issuer);
    await daicpxdToken.mint(depot.address, toTokenUnit(1000));
  });

  it.only("can transfer a prepaid card to a customer", async () => {
    let {
      prepaidCards: [prepaidCard],
    } = await createPrepaidCards(
      depot,
      prepaidCardManager,
      daicpxdToken,
      daicpxdToken,
      issuer,
      relayer,
      [toTokenUnit(10)]
    );
    await cardcpxdToken.mint(prepaidCard.address, toTokenUnit(1));

    await transferOwner(
      prepaidCardManager,
      prepaidCard,
      issuer,
      prepaidCardMarket.address,
      cardcpxdToken,
      relayer,
      daicpxdToken
    );

    expect(
      await prepaidCardManager.getPrepaidCardOwner(prepaidCard.address)
    ).to.equal(prepaidCardMarket.address);

    await transferOwner(
      prepaidCardManager,
      prepaidCard,
      prepaidCardMarket.address,
      customer,
      cardcpxdToken,
      relayer,
      daicpxdToken,
      // try testing with an invalid signature like 0x12345 to see the transfer fail
      "0xdeadbeef"
    );

    expect(
      await prepaidCardManager.getPrepaidCardOwner(prepaidCard.address)
    ).to.equal(customer);
  });
});
