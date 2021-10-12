const Feed = artifacts.require("ManualFeed");
const { BN } = require("web3").utils;
const { expect } = require("./setup");

contract("Feed", async (accounts) => {
  let [owner, nonOwner] = accounts;
  let feed;
  before(async () => {
    feed = await Feed.new();
    await feed.initialize(owner);
  });

  it("can create feed", async () => {
    await feed.setup("DAI.CPXD/USD", 8);

    expect(BN(await feed.version()).toString()).to.equal("3");
    expect(BN(await feed.decimals()).toString()).to.equal("8");
    expect(await feed.description()).to.equal("DAI.CPXD/USD");
  });

  it("allows an owner to add a round", async () => {
    await feed.addRound(100000000, 1618420000, 1618420001);
    await feed.addRound(110000000, 1618430000, 1618430001);

    {
      let { roundId, answer, startedAt, updatedAt, answeredInRound } =
        await feed.latestRoundData();
      expect(BN(roundId).toString()).to.equal("2");
      expect(BN(answer).toString()).to.equal("110000000");
      expect(BN(startedAt).toString()).to.equal("1618430000");
      expect(BN(updatedAt).toString()).to.equal("1618430001");
      expect(BN(answeredInRound).toString()).to.equal("2");
    }

    {
      let { roundId, answer, startedAt, updatedAt, answeredInRound } =
        await feed.getRoundData(1);
      expect(BN(roundId).toString()).to.equal("1");
      expect(BN(answer).toString()).to.equal("100000000");
      expect(BN(startedAt).toString()).to.equal("1618420000");
      expect(BN(updatedAt).toString()).to.equal("1618420001");
      expect(BN(answeredInRound).toString()).to.equal("1");
    }

    expect(BN(await feed.currentRound()).toString()).to.equal("2");
  });

  it("rejects when non-owner adds a round", async () => {
    await feed
      .addRound(100000000, 1618420000, 1618420001, { from: nonOwner })
      .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
  });

  it("rejects when requested round does not exist", async () => {
    await feed
      .getRoundData(1000)
      .should.be.rejectedWith(Error, "No data present");
  });

  it("can get version of contract", async () => {
    expect(await feed.cardpayVersion()).to.match(/\d\.\d\.\d/);
  });
});
