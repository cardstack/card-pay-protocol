const { assert } = require("chai");

const SPEND = artifacts.require("SPEND");

contract("SPEND", (accounts) => {
  let instance;
  let owner, alice, bob;
  before(async () => {
    owner = accounts[0];
    alice = accounts[1];
    bob = accounts[2];
    instance = await SPEND.new("SPEND Token", "SPEND", owner);
  });

  it("can display token contract values", async () => {
    let name = await instance.name();
    assert.equal(name, "SPEND Token");
    let symbol = await instance.symbol();
    assert.equal(symbol, "SPEND");
    let decimals = await instance.decimals();
    assert.equal(decimals, 0);
  });

  it("can allow owner to mint tokens to herself", async () => {
    let amount = web3.utils.toBN("1000000000000000");
    await instance.mint(owner, amount, { from: owner });
    let balance = await instance.balanceOf(owner);
    let totalSupply = await instance.totalSupply();
    assert.equal(balance.toString(), amount.toString());
    assert.equal(totalSupply.toString(), amount.toString());
  });

  it("can allow owner to mint tokens for another account", async () => {
    let amount = web3.utils.toBN("1000000000000000");
    await instance.mint(alice, amount, { from: owner });
    let balance = await instance.balanceOf(alice);
    assert.equal(balance.toString(), amount.toString());
  });

  it("does not allow non-owner to mint tokens", async () => {
    try {
      let amount = web3.utils.toBN("1000000000000000");
      await instance.mint(bob, amount, { from: alice });
      assert.fail("don't got error");
    } catch (error) {
      assert.equal(error.reason, "Minter: caller is not the minter");
    }
  });

  it("allows owner to burn tokens", async () => {
    let totalSupply = await instance.totalSupply();
    assert.equal(totalSupply.toString(), "2000000000000000");
    let amount = web3.utils.toBN("1000000000000000");
    await instance.burn(owner, amount, { from: owner });
    let balance = await instance.balanceOf(owner);
    assert.equal(balance.toString(), "0");
    totalSupply = await instance.totalSupply();
    assert.equal(totalSupply.toString(), "1000000000000000");
  });

  it("does not allow non-owner to burn tokens", async () => {
    try {
      let amount = web3.utils.toBN("1000000000000000");
      await instance.burn(owner, amount, { from: alice });
      assert.fail("don't get error");
    } catch (error) {
      assert.equal(error.reason, "sender is not a minter");
    }
  });

  it("noes not allow the more tokens to be burned than the account's balance", async () => {
    try {
      let amount = web3.utils.toBN("10");
      await instance.burn(bob, amount);
      assert.fail("don't get error");
    } catch (error) {
      assert.equal(error.reason, "burn amount exceeds balance");
    }
  });

  it("does not allow tokens to be minted for the zero address", async () => {
    let revered = false;

    try {
      await instance.mint("0x0000000000000000000000000000000000000000", 10);
    } catch (error) {
      revered = true;
      assert.equal(error.reason, "cannot mint to zero address");
    }

    assert.isTrue(revered);
  });

  it("it does not allow tokens to be burned from the zero address", async () => {
    let revered = false;

    try {
      await instance.burn("0x0000000000000000000000000000000000000000", 10);
    } catch (error) {
      revered = true;
      assert.equal(error.reason, "cannot burn from zero address");
    }

    assert.isTrue(revered);
  });

  it("can add and remove minter roles", async () => {
    let newMinter = accounts[8];
    await instance.removeMinter(accounts[0]).should.be.fulfilled;

    await instance.addMinter(newMinter).should.be.fulfilled;

    let currentMinters = await instance.getMinters();
    assert.deepEqual([newMinter], currentMinters);
  });
});
