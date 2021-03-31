const SPEND = artifacts.require('SPEND');

contract('Test SPEND contract', accounts => {
    let instance;
    let owner, alice, bob; 
    before( async() => {
        owner = accounts[0];
        alice = accounts[1];
        bob = accounts[2];
        instance = await SPEND.new("SPEND Token", "SPEND", [owner]);
       
    })

    it("Mint token from owner", async() => {
        let amount = web3.utils.toBN("1000000000000000");
        await instance.mint(owner, amount, {from : owner});
        let balance = await instance.balanceOf(owner);
        assert.equal(balance.toString(), amount.toString());
    })

    it("Mint token for other account from owner", async() => {
        let amount = web3.utils.toBN("1000000000000000");
        await instance.mint(alice, amount, {from : owner});
        let balance = await instance.balanceOf(alice);
        assert.equal(balance.toString(), amount.toString());
    })

    it("Mint token from alice (should get error)", async() => {
        try {
            let amount = web3.utils.toBN("1000000000000000");
            await instance.mint(bob, amount, {from : alice});
            assert.fail("don't got error");
        } catch(error) {
            assert.equal(error.reason, "Minter: caller is not the minter");
        }
    })

    it("Mint token for owner from alice (should get error)", async() => {
        try {
            let amount = web3.utils.toBN("1000000000000000");
            await instance.mint(owner, amount, {from : alice});
            assert.fail("don't got error");
        } catch(error) {
            assert.equal(error.reason, "Minter: caller is not the minter");
        }
    })

    it("Burn token from owner", async() => {
        let amount = web3.utils.toBN("1000000000000000");
        await instance.burn(owner, amount, {from : owner});
        let balance = await instance.balanceOf(owner);
        assert.equal(balance.toString(), "0");
    }) 

    it("Burn token from alice (should get error)", async() => {
        try {
            let amount = web3.utils.toBN("1000000000000000");
            await instance.burn(owner, amount, {from : alice});
            assert.fail("don't get error");
        } catch(error) {
            assert.equal(error.reason, "Minter: caller is not the minter");
        }
    }) 

    it("Burn number token greater than current number token of account", async() => {
        try {
            let amount = web3.utils.toBN("10"); 
            await instance.burn(bob, amount);
            assert.fail("don't get error");
        } catch(error) {
            assert.equal(error.reason, "ERC20: burn amount exceeds balance");
        }
    })
    
    it("Mint for zero address", async() => {
        let revered = false; 

        try {
            await instance.mint("0x0000000000000000000000000000000000000000", 10); 
        } catch(error) {
            revered = true;
            assert.equal(error.reason, "ERC20: mint to the zero address");
        }

        assert.isTrue(revered)
    })

    it("Burn for zero address", async() => {
        let revered = false; 

        try {
            await instance.burn("0x0000000000000000000000000000000000000000", 10); 
        } catch(error) {
            revered = true;
            assert.equal(error.reason, "ERC20: burn from the zero address");
        }

        assert.isTrue(revered)
    })

    it("Role test", async() => {
        let newMinter = accounts[8]; 
        await instance.removeMinter(accounts[0]);
        
        await instance.addMinter(newMinter);

        let currentMinters = await instance.getMinters()
        assert.deepEqual([newMinter], currentMinters);
    })       

})
