const { assert } = require("chai");
const ERC677Token = artifacts.require("ERC677Token");

contract("ERC677Token", (accounts) => {
  let instance, owner;
  before(async () => {
    owner = accounts[0];
    instance = await ERC677Token.new();
    await instance.initialize("DAICPXD Token", "DAICPXD", 18, owner);
  });

  it("can display token contract values", async () => {
    let name = await instance.name();
    assert.equal(name, "DAICPXD Token");
    let symbol = await instance.symbol();
    assert.equal(symbol, "DAICPXD");
    let decimals = await instance.decimals();
    assert.equal(decimals, 18);
  });
});
