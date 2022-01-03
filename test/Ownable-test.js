const Ownable = artifacts.require("Ownable.sol");
const { expect } = require("./setup");
contract("Ownable", function (accounts) {
  let ownable;
  const [deployer, owner] = accounts;

  beforeEach(async () => {
    ownable = await Ownable.new();
  });

  it("allows initializing by the owner", async () => {
    await ownable.initialize(deployer);
    expect(await ownable.owner()).to.eq(deployer);
  });

  it("allows initializing by not the owner", async () => {
    await ownable.initialize(owner);
    expect(await ownable.owner()).to.eq(owner);
  });
});
