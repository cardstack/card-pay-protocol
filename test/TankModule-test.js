const { assert } = require("./setup");
const { artifacts, contract, network } = require("hardhat");
const { toBN } = require("web3-utils");
const { constants } = require("ethers");
const { signAndSendSafeTransaction } = require("./utils/helper");

const GnosisSafeProxyFactory = artifacts.require("GnosisSafeProxyFactory.sol");
const GnosisSafe = artifacts.require("GnosisSafe.sol");
const MerchantManager = artifacts.require("MerchantManager.sol");
const TokenManager = artifacts.require("TokenManager.sol");
const TankModule = artifacts.require("TankModule.sol");
const JarGuard = artifacts.require("JarGuard.sol");
const ERC677Token = artifacts.require("ERC677Token.sol");

contract("TankModule", (accounts) => {
  let gnosisSafeProxyFactory,
    jar,
    merchantManager,
    tokenManager,
    tankModule,
    jarGuard,
    erc677Token;
  let owner, feeReceiver;

  before(async () => {
    owner = accounts[0];
    feeReceiver = accounts[1];

    erc677Token = await ERC677Token.new();
    await erc677Token.initialize("TEST", "TEST", 10, owner);

    merchantManager = await MerchantManager.new();
    await merchantManager.initialize(owner);

    tokenManager = await TokenManager.new();
    await tokenManager.initialize(owner);
    await tokenManager.addPayableToken(erc677Token.address);

    gnosisSafeProxyFactory = await GnosisSafeProxyFactory.new();
    const gnosisSingleton = await GnosisSafe.new();
    const gnosisSetupCall = gnosisSingleton.contract.methods
      .setup(
        [owner],
        1,
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
        constants.AddressZero,
        0,
        constants.AddressZero
      )
      .encodeABI();
    const resultGnosisFactory = await gnosisSafeProxyFactory.createProxy(
      gnosisSingleton.address,
      gnosisSetupCall
    );
    jar = await GnosisSafe.at(resultGnosisFactory.logs[0].args.proxy);

    tankModule = await TankModule.new(
      jar.address,
      jar.address,
      jar.address,
      merchantManager.address,
      tokenManager.address,
      feeReceiver,
      toBN("10000000"),
      toBN("600"),
      toBN("1")
    );

    jarGuard = await JarGuard.new(
      jar.address,
      jar.address,
      [tankModule.address],
      tankModule.address
    );

    const enableModule = jar.contract.methods.enableModule(tankModule.address);
    const enableModuleSafeTx = {
      to: jar.address,
      data: enableModule.encodeABI(),
      txGasEstimate: await enableModule.estimateGas({ from: jar.address }),
      gasPrice: 0,
      txGasToken: constants.AddressZero,
      refundReceiver: constants.AddressZero,
    };
    await signAndSendSafeTransaction(enableModuleSafeTx, owner, jar, owner);

    const setGuard = jar.contract.methods.setGuard(jarGuard.address);
    const setGuardSafeTx = {
      to: jar.address,
      data: setGuard.encodeABI(),
      txGasEstimate: await setGuard.estimateGas({ from: jar.address }),
      gasPrice: 0,
      txGasToken: constants.AddressZero,
      refundReceiver: constants.AddressZero,
    };
    await signAndSendSafeTransaction(setGuardSafeTx, owner, jar, owner);
  });

  describe("transfer fund flow", () => {
    let queueNonce;

    it("should increase queue nonce and locked fund", async () => {
      const sender = accounts[3];

      const tokenMinted = toBN("20000000000");
      await erc677Token.mint(sender, tokenMinted);
      const initBalance = await erc677Token.balanceOf(sender);
      assert.equal(initBalance.toString(), tokenMinted.toString());

      const initialQueueNonce = await tankModule.queueNonce();
      const initialSafeBalance = await erc677Token.balanceOf(jar.address);

      const transferAmount = toBN("10000000000");
      await erc677Token.transferAndCall(
        tankModule.address,
        transferAmount,
        constants.AddressZero,
        { from: sender }
      );

      queueNonce = await tankModule.queueNonce();
      const finalSafeBalance = await erc677Token.balanceOf(jar.address);
      assert.equal(
        queueNonce.toString(),
        initialQueueNonce.add(toBN(1)).toString()
      );
      assert.equal(
        finalSafeBalance.toString(),
        initialSafeBalance.add(transferAmount).toString()
      );
      assert.equal(
        (await tankModule.lockedAmount(erc677Token.address)).toString(),
        transferAmount.toString()
      );
    });

    it("should failed transfer fund that hasn't been released yet", async () => {
      const transferAmount = toBN("10000000000");
      const transferToken = erc677Token.contract.methods.transfer(
        accounts[3],
        transferAmount
      );
      const transferSafeTx = {
        to: erc677Token.address,
        data: transferToken.encodeABI(),
        txGasEstimate: await transferToken.estimateGas({ from: jar.address }),
        gasPrice: 0,
        txGasToken: constants.AddressZero,
        refundReceiver: constants.AddressZero,
      };

      await signAndSendSafeTransaction(
        transferSafeTx,
        owner,
        jar,
        owner
      ).should.be.rejectedWith(Error, "cannot exceed balance - lockedBalance");
    });

    it("should failed release fund that still in locking period", async () => {
      await tankModule
        .releaseFund()
        .should.be.rejectedWith(Error, "fund still in locking period");
    });

    it("should success release fund after locking period", async () => {
      await network.provider.send("evm_increaseTime", [3600]);
      await tankModule.releaseFund().should.not.be.rejected;

      const finalSafeBalance = await erc677Token.balanceOf(jar.address);
      const finalFeeReceiverBalance = await erc677Token.balanceOf(feeReceiver);

      assert.equal(finalSafeBalance.toString(), "9000000000");
      assert.equal(finalFeeReceiverBalance.toString(), "1000000000"); // 10% of released fund
    });

    it("should success transfer fund that has been released", async () => {
      const transferAmount = toBN("9000000000");
      const transferToken = erc677Token.contract.methods.transfer(
        accounts[3],
        transferAmount
      );
      const transferSafeTx = {
        to: erc677Token.address,
        data: transferToken.encodeABI(),
        txGasEstimate: await transferToken.estimateGas({ from: jar.address }),
        gasPrice: 0,
        txGasToken: constants.AddressZero,
        refundReceiver: constants.AddressZero,
      };

      await signAndSendSafeTransaction(transferSafeTx, owner, jar, owner).should
        .not.be.rejected;

      const finalSafeBalance = await erc677Token.balanceOf(jar.address);
      assert.equal(finalSafeBalance.toString(), "0");
    });

    it("should failed to claimback fund that has been released", async () => {
      await tankModule
        .claimBackFund(queueNonce)
        .should.be.rejectedWith(Error, "fund not in locking period");
    });
  });

  describe("cancel fund flow", () => {
    let queueNonce, sender;

    before(async () => {
      sender = accounts[3];

      const tokenMinted = toBN("20000000000");
      await erc677Token.mint(sender, tokenMinted);

      queueNonce = await tankModule.queueNonce();
      const transferAmount = toBN("10000000000");
      await erc677Token.transferAndCall(
        tankModule.address,
        transferAmount,
        constants.AddressZero,
        { from: sender }
      );
    });

    it("can cancel or claim back fund that still in locking period", async () => {
      const initialSenderBalance = await erc677Token.balanceOf(sender);
      await tankModule.claimBackFund(queueNonce).should.not.be.rejected;

      const lockedFund = await tankModule.lockedFund(queueNonce);
      assert.equal(
        (await erc677Token.balanceOf(sender)).toString(),
        initialSenderBalance.add(lockedFund.amount).toString()
      );
      assert.isTrue(lockedFund.isRefunded);
    });
  });
});
