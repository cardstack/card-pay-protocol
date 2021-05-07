const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const ERC677Token = artifacts.require("ERC677Token.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const Feed = artifacts.require("ManualFeed");
const ChainlinkOracle = artifacts.require("ChainlinkFeedAdapter");
const MockDIAOracle = artifacts.require("MockDIAOracle");
const DIAPriceOracle = artifacts.require("DIAOracleAdapter");

const { getGnosisSafeFromEventLog } = require("./utils/general");

const {
  toTokenUnit,
  encodeCreateCardsData,
  shouldBeSameBalance,
} = require("./utils/helper");

const { TOKEN_DETAIL_DATA, expect } = require("./setup");

contract("PrepaidCardManager - EOA tests", (accounts) => {
  let daicpxdToken,
    revenuePool,
    spendToken,
    owner,
    prepaidCardManager,
    offChainId = "Id",
    tally,
    merchant,
    gasFeeReceiver,
    supplierEOA,
    cards = [];

  before(async () => {
    tally = owner = accounts[0];
    merchant = accounts[3];
    supplierEOA = accounts[8];
    gasFeeReceiver = accounts[9];

    let proxyFactory = await ProxyFactory.new();
    let gnosisSafeMasterCopy = await GnosisSafe.new();

    revenuePool = await RevenuePool.new();
    await revenuePool.initialize(owner);

    spendToken = await SPEND.new();
    await spendToken.initialize(owner, revenuePool.address);

    // Deploy and mint 100 daicpxd token for deployer as owner
    daicpxdToken = await ERC677Token.new();
    await daicpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await daicpxdToken.mint(supplierEOA, toTokenUnit(20));

    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);

    // Setup for revenue pool
    await revenuePool.setup(
      tally,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      spendToken.address,
      [daicpxdToken.address]
    );

    let feed = await Feed.new();
    await feed.initialize(owner);
    await feed.setup("DAI.CPXD", 8);
    await feed.addRound(100000000, 1618433281, 1618433281);
    let ethFeed = await Feed.new();
    await ethFeed.initialize(owner);
    await ethFeed.setup("ETH", 8);
    await ethFeed.addRound(300000000000, 1618433281, 1618433281);
    let chainlinkOracle = await ChainlinkOracle.new();
    chainlinkOracle.initialize(owner);
    await chainlinkOracle.setup(feed.address, ethFeed.address);

    let mockDiaOracle = await MockDIAOracle.new();
    await mockDiaOracle.initialize(owner);
    await mockDiaOracle.setValue("CARD/USD", 1000000, 1618433281);
    let diaPrice = await DIAPriceOracle.new();
    await diaPrice.initialize(owner);
    await diaPrice.setup(mockDiaOracle.address, "CARD");

    await revenuePool.createExchange("DAI", chainlinkOracle.address);
    await revenuePool.createExchange("CARD", diaPrice.address);
    await revenuePool.registerMerchant(merchant, offChainId);

    await prepaidCardManager.setup(
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      revenuePool.address,
      gasFeeReceiver,
      0,
      [daicpxdToken.address],
      100,
      500000
    );
  });

  it("create multiple cards by EOA account", async () => {
    let amounts = [1, 2, 10].map((amount) => toTokenUnit(amount));

    let data = encodeCreateCardsData(supplierEOA, amounts);

    let tx = await daicpxdToken.transferAndCall(
      prepaidCardManager.address,
      toTokenUnit(13),
      data,
      {
        from: supplierEOA,
      }
    );

    cards = await getGnosisSafeFromEventLog(tx, prepaidCardManager.address);

    expect(cards.length).to.equal(3);

    for (let i = 0; i < cards.length; ++i) {
      let card = cards[i];
      expect(await card.isOwner(supplierEOA)).to.be.ok;
      await shouldBeSameBalance(daicpxdToken, card.address, amounts[i]);
    }

    await shouldBeSameBalance(daicpxdToken, supplierEOA, toTokenUnit(7));
  });

  // The tests are stateful. The supplier originally had 20 tokens, but after
  // the previous test they now have only 7 tokens remaining
  it("cannot create cards from an EOA account when the token value sent to the prepaid card manager contract is more than the balance of the EOA", async () => {
    try {
      let amounts = [1, 2, 3].map((amount) => toTokenUnit(amount));

      let data = encodeCreateCardsData(supplierEOA, amounts);

      await daicpxdToken.transferAndCall(
        prepaidCardManager.address,
        toTokenUnit(10),
        data,
        {
          from: supplierEOA,
        }
      );
      throw new Error(`call did not fail`);
    } catch (err) {
      expect(err.reason).to.be.equal("ERC20: transfer amount exceeds balance");
    }
  });

  it("cannot create cards from an EOA account when the face values of the cards add up to more than the amount of tokens being sent", async () => {
    try {
      let amounts = [1, 2, 9].map((amount) => toTokenUnit(amount));

      let data = encodeCreateCardsData(supplierEOA, amounts);

      await daicpxdToken.transferAndCall(
        prepaidCardManager.address,
        toTokenUnit(6),
        data,
        {
          from: supplierEOA,
        }
      );
      throw new Error(`call did not fail`);
    } catch (err) {
      expect(err.reason).to.be.equal("Not enough token");
    }
  });
});
