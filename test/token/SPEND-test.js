const { assert } = require("chai");
const SPEND = artifacts.require("SPEND");

contract("SPEND", (accounts) => {
  let instance, owner, alice, bob, owner2, minter;
  before(async () => {
    owner = accounts[0];
    alice = accounts[1];
    bob = accounts[2];
    owner2 = accounts[3];
    minter = accounts[4];
    instance = await SPEND.new();
    await instance.initialize(owner);
    await instance.addMinter(minter);
  });

  it("can display token contract values", async () => {
    let name = await instance.name();
    assert.equal(name, "SPEND Token");
    let symbol = await instance.symbol();
    assert.equal(symbol, "SPEND");
    let decimals = await instance.decimals();
    assert.equal(decimals, 0);
  });

  it("can allow minter to mint tokens to herself", async () => {
    let amount = web3.utils.toBN("1000000000000000");
    await instance.mint(minter, amount, { from: minter });
    let balance = await instance.balanceOf(minter);
    let totalSupply = await instance.totalSupply();
    assert.equal(balance.toString(), amount.toString());
    assert.equal(totalSupply.toString(), amount.toString());
  });

  it("can allow owner to mint tokens for another account", async () => {
    let amount = web3.utils.toBN("1000000000000000");
    await instance.mint(alice, amount, { from: minter });
    let balance = await instance.balanceOf(alice);
    assert.equal(balance.toString(), amount.toString());
  });

  it("does not allow non-minter to mint tokens", async () => {
    try {
      let amount = web3.utils.toBN("1000000000000000");
      await instance.mint(bob, amount, { from: alice });
      assert.fail("don't got error");
    } catch (error) {
      assert.equal(error.reason, "caller is not a minter");
    }
  });

  it("does not allow non-owner to add a minter", async () => {
    try {
      await instance.addMinter(alice, { from: alice });
      assert.fail("don't got error");
    } catch (error) {
      assert.equal(error.reason, "caller is not the owner");
    }
  });

  it("allows minter to burn tokens", async () => {
    let totalSupply = await instance.totalSupply();
    assert.equal(totalSupply.toString(), "2000000000000000");
    let amount = web3.utils.toBN("1000000000000000");
    await instance.burn(minter, amount, { from: minter });
    let balance = await instance.balanceOf(minter);
    assert.equal(balance.toString(), "0");
    totalSupply = await instance.totalSupply();
    assert.equal(totalSupply.toString(), "1000000000000000");
  });

  it("does not allow non-minter to burn tokens", async () => {
    try {
      let amount = web3.utils.toBN("1000000000000000");
      await instance.burn(minter, amount, { from: alice });
      assert.fail("don't get error");
    } catch (error) {
      assert.equal(error.reason, "caller is not a minter");
    }
  });

  it("does not allow more tokens to be burned than the account's balance", async () => {
    try {
      let amount = web3.utils.toBN("10");
      await instance.burn(bob, amount, { from: minter });
      assert.fail("don't get error");
    } catch (error) {
      assert.equal(error.reason, "burn amount exceeds balance");
    }
  });

  it("does not allow tokens to be minted for the zero address", async () => {
    let revered = false;

    try {
      await instance.mint("0x0000000000000000000000000000000000000000", 10, {
        from: minter,
      });
    } catch (error) {
      revered = true;
      assert.equal(error.reason, "cannot mint to zero address");
    }

    assert.isTrue(revered);
  });

  it("it does not allow tokens to be burned from the zero address", async () => {
    let revered = false;

    try {
      await instance.burn("0x0000000000000000000000000000000000000000", 10, {
        from: minter,
      });
    } catch (error) {
      revered = true;
      assert.equal(error.reason, "cannot burn from zero address");
    }

    assert.isTrue(revered);
  });

  it("can add and remove minter roles", async () => {
    let newMinter = accounts[8];
    await instance.removeMinter(minter).should.be.fulfilled;

    await instance.addMinter(newMinter).should.be.fulfilled;

    let currentMinters = await instance.getMinters();
    assert.deepEqual([newMinter], currentMinters);
  });

  it("can transfer ownership of the token contract", async () => {
    assert.equal(await instance.owner(), owner);
    await instance.transferOwnership(owner2);
    assert.equal(await instance.owner(), owner2);
    await instance.transferOwnership(owner, { from: owner2 });
  });

  it("can renounce ownership of the token contract", async () => {
    assert.equal(await instance.owner(), owner);
    await instance.renounceOwnership();
    assert.equal(
      await instance.owner(),
      "0x0000000000000000000000000000000000000000"
    );
  });
});
