const ERC677Token = artifacts.require("ERC677Token.sol");
const SPEND = artifacts.require("SPEND.sol");
const Exchange = artifacts.require("Exchange");

const { expect, TOKEN_DETAIL_DATA } = require("./setup");
const { fromWei } = require("web3").utils;

const {
  toTokenUnit,
  setupExchanges,
  setupVersionManager,
} = require("./utils/helper");

contract("Exchange", (accounts) => {
  let daicpxdToken,
    spendToken,
    fakeToken,
    daiFeed,
    daiOracle,
    versionManager,
    cardOracle,
    owner,
    exchange;

  before(async () => {
    owner = accounts[0];

    versionManager = await setupVersionManager(owner);
    spendToken = await SPEND.new();
    await spendToken.initialize(owner);
    await spendToken.setup(versionManager.address);

    ({
      daiFeed,
      daicpxdToken,
      exchange,
      diaPriceOracle: cardOracle,
      chainlinkOracle: daiOracle,
    } = await setupExchanges(owner, versionManager));

    await daicpxdToken.mint(owner, toTokenUnit(100));
    fakeToken = await ERC677Token.new();
    await fakeToken.initialize(...TOKEN_DETAIL_DATA, owner);
    await fakeToken.mint(owner, toTokenUnit(100));
  });

  it("can get version of contract", async () => {
    expect(await exchange.cardpayVersion()).to.equal("1.0.0");
    expect(await spendToken.cardpayVersion()).to.equal("1.0.0");
  });

  describe("exchange rate", () => {
    afterEach(async () => {
      // reset the rate to 1:1
      await daiFeed.addRound(100000000, 1618435000, 1618435000);
    });

    it("can convert an amount of CARD to the specified token", async () => {
      // The configured rate is 1 DAI : 100 CARD
      let amount = await exchange.convertFromCARD(
        daicpxdToken.address,
        toTokenUnit(100)
      );
      expect(fromWei(amount)).to.equal("1");
    });

    it("can convert a token amount to SPEND", async () => {
      // The configured rate is 1^18 DAI : 100 SPEND
      let amount = await exchange.convertToSpend(
        daicpxdToken.address,
        toTokenUnit(1)
      );
      expect(amount.toString()).to.equal("100");
    });

    it("can convert a SPEND amount to a token", async () => {
      // The configured rate is 1^18 DAI : 100 SPEND
      let amount = await exchange.convertFromSpend(daicpxdToken.address, 100);
      expect(fromWei(amount)).to.equal("1");
    });

    it("rejects when converting from CARD and no CARD exchange has been added", async () => {
      let badExchange = await Exchange.new();
      await badExchange.initialize(owner);
      await badExchange.setup(1000000, versionManager.address, "CARD.CPXD"); // this is a 1% rate margin drift
      await badExchange.createExchange("DAI.CPXD", daiOracle.address);

      await badExchange
        .convertFromCARD(daicpxdToken.address, toTokenUnit(100))
        .should.be.rejectedWith(Error, "no exchange exists for CARD");
    });

    it("rejects when converting from CARD and no exchange has been added for desired token", async () => {
      let badExchange = await Exchange.new();
      await badExchange.initialize(owner);
      await badExchange.setup(1000000, versionManager.address, "CARD.CPXD"); // this is a 1% rate margin drift
      await badExchange.createExchange("CARD.CPXD", cardOracle.address);

      await badExchange
        .convertFromCARD(daicpxdToken.address, toTokenUnit(100))
        .should.be.rejectedWith(Error, "no exchange exists for token");
    });

    it("rejects when rate drift percentage is out of limits", async () => {
      let badExchange = await Exchange.new();
      await badExchange.initialize(owner);
      await badExchange
        .setup(10000000, versionManager.address, "CARD.CPXD") // = 10% rate drift
        .should.be.rejectedWith(
          Error,
          "rate drift percentage must be between 0 and 1%"
        );
    });
  });
});
