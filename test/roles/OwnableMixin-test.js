const { expect } = require("../setup");
const TestContract = artifacts.require("ManualFeed");
const { ZERO_ADDRESS } = require("../utils/general");

contract("OwnableMixin", (accounts) => {
  let instance, owner, anotherOwner, someone;

  beforeEach(async () => {
    [owner, anotherOwner, someone] = accounts;
    instance = await TestContract.new();
    await instance.initialize(owner);
  });

  it("can get the owner", async () => {
    expect(await instance.owner()).to.equal(owner);
  });

  it("non-owner cannot transfer ownership", async () => {
    await instance
      .transferOwnership(anotherOwner, { from: someone })
      .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
  });

  it("owner can transfer ownership", async () => {
    await instance.transferOwnership(anotherOwner, { from: owner });
    expect(await instance.owner()).to.equal(anotherOwner);
  });

  it("cannot transfer ownership to zero address", async () => {
    await instance
      .transferOwnership(ZERO_ADDRESS, { from: owner })
      .should.be.rejectedWith(Error, "Ownable: new owner is the zero address");
  });

  it("non-owner cannot renounce ownership", async () => {
    await instance
      .renounceOwnership({ from: someone })
      .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
  });

  it("can renounce ownership", async () => {
    await instance.renounceOwnership({ from: owner });

    expect(await instance.owner()).to.equal(ZERO_ADDRESS);
  });
});
