const { assert } = require("chai");
const ERC677Token = artifacts.require("ERC677Token");

contract("ERC677Token", (accounts) => {
  let instance, owner;
  before(async () => {
    owner = accounts[0];
    instance = await ERC677Token.new();
    await instance.initialize("DAI.CPXD", "DAI", 18, owner);
  });

  it("can display token contract values", async () => {
    let name = await instance.name();
    assert.equal(name, "DAI.CPXD");
    let symbol = await instance.symbol();
    assert.equal(symbol, "DAI");
    let decimals = await instance.decimals();
    assert.equal(decimals, 18);
  });
});
