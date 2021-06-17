const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const ERC677Token = artifacts.require("ERC677Token.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");

const { TOKEN_DETAIL_DATA, toBN, expect } = require("./setup");
const {
  toTokenUnit,
  shouldBeSameBalance,
  createDepotSafe,
  setupExchanges,
  createPrepaidCards,
  transferOwner,
} = require("./utils/helper");

contract("PrepaidCardManager - issuer tests", (accounts) => {
  let daicpxdToken,
    cardcpxdToken,
    revenuePool,
    spendToken,
    prepaidCardManager,
    exchange,
    fakeDaicpxdToken,
    owner,
    issuer,
    customer,
    relayer,
    gasFeeReceiver,
    merchantFeeReceiver,
    depot,
    prepaidCards = [];

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    customer = accounts[2];
    relayer = accounts[4];
    gasFeeReceiver = accounts[5];
    merchantFeeReceiver = accounts[7];

    let proxyFactory = await ProxyFactory.new();
    let gnosisSafeMasterCopy = await GnosisSafe.new();
    revenuePool = await RevenuePool.new();
    await revenuePool.initialize(owner);
    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);
    spendToken = await SPEND.new();
    await spendToken.initialize(owner);
    await spendToken.addMinter(revenuePool.address);

    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));
    await daicpxdToken.mint(owner, toTokenUnit(1000));

    fakeDaicpxdToken = await ERC677Token.new();
    await fakeDaicpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await fakeDaicpxdToken.mint(owner, toTokenUnit(1000));

    depot = await createDepotSafe(gnosisSafeMasterCopy, proxyFactory, issuer);

    // Transfer 20 daicpxd to issuer's wallet
    await daicpxdToken.mint(depot.address, toTokenUnit(20));

    // Transfer 20 daicpxd to issuer's wallet
    await fakeDaicpxdToken.mint(depot.address, toTokenUnit(20));

    // Setup for revenue pool
    await revenuePool.setup(
      exchange.address,
      prepaidCardManager.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      [daicpxdToken.address],
      merchantFeeReceiver,
      0,
      1000
    );

    await prepaidCardManager.setup(
      exchange.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      revenuePool.address,
      gasFeeReceiver,
      0,
      [daicpxdToken.address, cardcpxdToken.address],
      cardcpxdToken.address,
      100,
      500000
    );
  });

  it("allows issuer to create cards", async () => {
    let oldWalletBalance = await daicpxdToken.balanceOf(depot.address);
    let oldRelayerBalance = await daicpxdToken.balanceOf(relayer);
    let amounts = [1, 2, 5].map((amount) => toTokenUnit(amount));

    let executionSucceeded;
    let paymentActual;
    ({
      prepaidCards, // Warning! this is used in other tests
      executionSucceeded,
      paymentActual,
    } = await createPrepaidCards(
      depot,
      prepaidCardManager,
      daicpxdToken,
      daicpxdToken,
      issuer,
      relayer,
      amounts
    ));

    expect(executionSucceeded).to.equal(true);
    expect(prepaidCards.length).to.be.equal(3);
    prepaidCards.forEach(async function (prepaidCard, index) {
      expect(await prepaidCard.isOwner(issuer)).to.be.equal(true);
      expect(await prepaidCard.isOwner(prepaidCardManager.address)).to.be.equal(
        true
      );
      shouldBeSameBalance(daicpxdToken, prepaidCard.address, amounts[index]);
    });
    await shouldBeSameBalance(
      daicpxdToken,
      depot.address,
      oldWalletBalance.sub(paymentActual).sub(toBN(toTokenUnit(8)))
    );

    await shouldBeSameBalance(
      daicpxdToken,
      relayer,
      oldRelayerBalance.add(paymentActual)
    );
  });

  it("allows issuer to transfer card to customer", async () => {
    await transferOwner(
      prepaidCardManager,
      prepaidCards[2],
      issuer,
      customer,
      relayer
    );

    expect(await prepaidCards[2].isOwner(customer)).to.be.equal(true);
    await shouldBeSameBalance(
      daicpxdToken,
      prepaidCards[2].address,
      toTokenUnit(5)
    );
  });
});
