const Feed = artifacts.require("ManualFeed");
const MockDIAOracle = artifacts.require("MockDIAOracle");
const DIAPriceOracle = artifacts.require("DIAOracleAdapter");
const ChainlinkPriceOracle = artifacts.require("ChainlinkFeedAdapter");
const { expect } = require("./setup");

contract("PriceOracle", async (accounts) => {
  let [owner, nonOwner] = accounts;

  describe("chainlink", () => {
    let tokenFeed, ethFeed, chainlinkPrice;
    before(async () => {
      tokenFeed = await Feed.new();
      await tokenFeed.initialize(owner);
      await tokenFeed.setup("DAI", 8);
      await tokenFeed.addRound(100000000, 1618433281, 1618433281);
      ethFeed = await Feed.new();
      await ethFeed.initialize(owner);
      await ethFeed.setup("ETH", 8);
      await ethFeed.addRound(300000000000, 1618433281, 1618433281);

      chainlinkPrice = await ChainlinkPriceOracle.new();
      await chainlinkPrice.initialize(owner);

      await chainlinkPrice.setup(tokenFeed.address, ethFeed.address);
    });

    it("can get version of contract", async () => {
      expect(await chainlinkPrice.cardProtocolVersion()).to.match(/\d\.\d\.\d/);
    });
    it("can get oracle decimals", async () => {
      expect((await chainlinkPrice.decimals()).toString()).to.equal("8");
    });
    it("can get oracle description", async () => {
      expect(await chainlinkPrice.description()).to.equal("DAI");
    });
    it("can get USD token price", async () => {
      let { price, updatedAt } = await chainlinkPrice.usdPrice();
      expect(price.toString()).to.equal("100000000");
      expect(updatedAt.toString()).to.equal("1618433281");
    });
    it("can get ETH token price", async () => {
      let { price, updatedAt } = await chainlinkPrice.ethPrice();
      expect(price.toString()).to.equal("33333");
      expect(updatedAt.toString()).to.equal("1618433281");
    });
    it("can reflect updated feed", async () => {
      await tokenFeed.addRound(150000000, "1618453281", "1618453281");
      {
        let { price, updatedAt } = await chainlinkPrice.usdPrice();
        expect(price.toString()).to.equal("150000000");
        expect(updatedAt.toString()).to.equal("1618453281");
      }
      {
        let { price, updatedAt } = await chainlinkPrice.ethPrice();
        expect(price.toString()).to.equal("50000");
        expect(updatedAt.toString()).to.equal("1618453281");
      }
    });
    it("rejects when non-owner calls setup()", async () => {
      await chainlinkPrice
        .setup(tokenFeed.address, ethFeed.address, { from: nonOwner })
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });
    it("rejects when token feed is not set", async () => {
      let badOracle = await ChainlinkPriceOracle.new();
      await badOracle.initialize(owner);
      await badOracle
        .usdPrice()
        .should.be.rejectedWith(Error, "feed address is not specified");
      await badOracle
        .ethPrice()
        .should.be.rejectedWith(Error, "feed address is not specified");
    });
    it("rejects when there is decimal mismatch in the USD and ETH feed", async () => {
      let badFeed = await Feed.new();
      await badFeed.initialize(owner);
      await badFeed.setup("DAI", 0);
      await badFeed.addRound(1, 1618433281, 1618433281);
      let badOracle = await ChainlinkPriceOracle.new();
      await badOracle.initialize(owner);
      await badOracle
        .setup(badFeed.address, ethFeed.address)
        .should.be.rejectedWith(Error, "feed decimals mismatch");
    });
  });

  describe("DIA", () => {
    let mockDiaOracle, diaPrice;
    before(async () => {
      mockDiaOracle = await MockDIAOracle.new();
      await mockDiaOracle.initialize(owner);
      await mockDiaOracle.setValue("CARD/USD", 1500000, 1618433281);
      await mockDiaOracle.setValue("CARD/ETH", 500, 1618433281);
      diaPrice = await DIAPriceOracle.new();
      await diaPrice.initialize(owner);
      await diaPrice.setup(mockDiaOracle.address, "CARD");
    });

    it("can get version of contract", async () => {
      expect(await diaPrice.cardProtocolVersion()).to.match(/\d\.\d\.\d/);
    });
    it("can get oracle decimals", async () => {
      expect((await diaPrice.decimals()).toString()).to.equal("8");
    });
    it("can get oracle description", async () => {
      expect(await diaPrice.description()).to.equal("CARD");
    });
    it("can get USD token price", async () => {
      let { price, updatedAt } = await diaPrice.usdPrice();
      expect(price.toString()).to.equal("1500000");
      expect(updatedAt.toString()).to.equal("1618433281");
    });
    it("can get ETH token price", async () => {
      let { price, updatedAt } = await diaPrice.ethPrice();
      expect(price.toString()).to.equal("500");
      expect(updatedAt.toString()).to.equal("1618433281");
    });
    it("can reflect updated feed", async () => {
      await mockDiaOracle.setValue("CARD/USD", 2000000, 1618453281);
      await mockDiaOracle.setValue("CARD/ETH", 667, 1618453281);
      {
        let { price, updatedAt } = await diaPrice.usdPrice();
        expect(price.toString()).to.equal("2000000");
        expect(updatedAt.toString()).to.equal("1618453281");
      }
      {
        let { price, updatedAt } = await diaPrice.ethPrice();
        expect(price.toString()).to.equal("667");
        expect(updatedAt.toString()).to.equal("1618453281");
      }
    });
    it("rejects when non-owner calls setup()", async () => {
      await diaPrice
        .setup(mockDiaOracle.address, "CARD", { from: nonOwner })
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });
    it("rejects when oracle is not set", async () => {
      let badOracle = await DIAPriceOracle.new();
      await badOracle.initialize(owner);
      await badOracle
        .usdPrice()
        .should.be.rejectedWith(Error, "DIA oracle is not specified");
      await badOracle
        .ethPrice()
        .should.be.rejectedWith(Error, "DIA oracle is not specified");
    });
  });
});
