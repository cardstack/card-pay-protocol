const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const ERC677Token = artifacts.require("ERC677Token.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const MultiSend = artifacts.require("MultiSend");

const { TOKEN_DETAIL_DATA, toBN, expect } = require("./setup");

const eventABIs = require("./utils/constant/eventABIs");
const {
  encodeMultiSendCall,
  ZERO_ADDRESS,
  getParamsFromEvent,
  getParamFromTxEvent,
  getGnosisSafeFromEventLog,
} = require("./utils/general");

const {
  toTokenUnit,
  encodeCreateCardsData,
  signAndSendSafeTransaction,
  shouldBeSameBalance,
} = require("./utils/helper");

contract("PrepaidCardManager - issuer tests", (accounts) => {
  let daicpxdToken,
    revenuePool,
    spendToken,
    prepaidCardManager,
    multiSend,
    offChainId = "Id",
    fakeDaicpxdToken,
    tally,
    issuer,
    customer,
    merchant,
    relayer,
    walletOfIssuer,
    prepaidCards = [];

  before(async () => {
    tally = accounts[0];
    issuer = accounts[1];
    customer = accounts[2];
    merchant = accounts[3];
    relayer = accounts[4];

    let proxyFactory = await ProxyFactory.new();
    let gnosisSafeMasterCopy = await GnosisSafe.new();
    multiSend = await MultiSend.new();
    revenuePool = await RevenuePool.new();
    spendToken = await SPEND.new("SPEND Token", "SPEND", revenuePool.address);

    // Deploy and mint 100 daicpxd token for deployer as owner
    daicpxdToken = await ERC677Token.new(...TOKEN_DETAIL_DATA);
    await daicpxdToken.mint(accounts[0], toTokenUnit(1000));
    // Deploy and mint 100 daicpxd token for deployer as owner
    fakeDaicpxdToken = await ERC677Token.new(...TOKEN_DETAIL_DATA);
    await fakeDaicpxdToken.mint(accounts[0], toTokenUnit(1000));

    walletOfIssuer = await getParamFromTxEvent(
      await proxyFactory.createProxy(
        gnosisSafeMasterCopy.address,
        gnosisSafeMasterCopy.contract.methods
          .setup(
            [issuer],
            1,
            ZERO_ADDRESS,
            "0x",
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            0,
            ZERO_ADDRESS
          )
          .encodeABI()
      ),
      "ProxyCreation",
      "proxy",
      proxyFactory.address,
      GnosisSafe,
      "create Gnosis Safe Proxy"
    );

    // Transfer 20 daicpxd to issuer's wallet
    await daicpxdToken.mint(walletOfIssuer.address, toTokenUnit(20));

    // Transfer 20 daicpxd to issuer's wallet
    await fakeDaicpxdToken.mint(walletOfIssuer.address, toTokenUnit(20));

    prepaidCardManager = await PrepaidCardManager.new();

    // Setup for revenue pool
    await revenuePool.setup(
      tally,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      spendToken.address,
      [daicpxdToken.address]
    );

    await revenuePool.registerMerchant(merchant, offChainId);

    await prepaidCardManager.setup(
      tally,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      revenuePool.address,
      [daicpxdToken.address],
      100,
      500000
    );
  });

  it("allows issuer to create cards", async () => {
    let oldWalletBalance = await daicpxdToken.balanceOf(walletOfIssuer.address);
    let oldRelayerBalance = await daicpxdToken.balanceOf(relayer);
    let amounts = [1, 2, 5].map((amount) => toTokenUnit(amount));

    let payloads = daicpxdToken.contract.methods
      .transferAndCall(
        prepaidCardManager.address,
        toTokenUnit(8),
        encodeCreateCardsData(walletOfIssuer.address, amounts)
      )
      .encodeABI();

    let gasEstimate = await daicpxdToken.contract.methods
      .transferAndCall(
        prepaidCardManager.address,
        toTokenUnit(8),
        encodeCreateCardsData(walletOfIssuer.address, amounts)
      )
      .estimateGas();

    let safeTxData = {
      to: daicpxdToken.address,
      value: 0,
      data: payloads,
      operation: 0,
      txGasEstimate: gasEstimate,
      baseGasEstimate: 0,
      gasPrice: 1000000000,
      txGasToken: daicpxdToken.address,
      refundReceive: relayer,
    };

    let { safeTxHash, safeTx } = await signAndSendSafeTransaction(
      safeTxData,
      issuer,
      walletOfIssuer,
      relayer
    );

    prepaidCards = await getGnosisSafeFromEventLog(
      safeTx,
      prepaidCardManager.address
    );

    let executeSuccess = getParamsFromEvent(
      safeTx,
      eventABIs.EXECUTION_SUCCESS,
      walletOfIssuer.address
    );

    expect(safeTxHash.toString()).to.be.equal(
      executeSuccess[executeSuccess.length - 1]["txHash"].toString(),
      "The event execute success should exist."
    );

    expect(prepaidCards.length).to.be.equal(
      3,
      "Should create a new 3 cards(gnosis safe)."
    );

    prepaidCards.forEach(async function (prepaidCard, index) {
      expect(await prepaidCard.isOwner(walletOfIssuer.address)).to.be.equal(
        true
      );
      expect(await prepaidCard.isOwner(prepaidCardManager.address)).to.be.equal(
        true
      );
      shouldBeSameBalance(daicpxdToken, prepaidCard.address, amounts[index]);
    });

    let payment = toBN(executeSuccess[executeSuccess.length - 1]["payment"]);
    await shouldBeSameBalance(
      daicpxdToken,
      walletOfIssuer.address,
      oldWalletBalance.sub(payment).sub(toBN(toTokenUnit(8)))
    );

    await shouldBeSameBalance(
      daicpxdToken,
      relayer,
      oldRelayerBalance.add(payment)
    );
  });

  it("allows issuer to transfer card to customer", async () => {
    let txs = [
      {
        to: prepaidCards[2].address,
        value: 0,
        data: prepaidCards[2].contract.methods
          .approveHash(
            await prepaidCardManager.getSellCardHash(
              prepaidCards[2].address,
              walletOfIssuer.address,
              customer,
              await prepaidCards[2].nonce.call()
            )
          )
          .encodeABI(),
      },
      {
        to: prepaidCardManager.address,
        value: 0,
        data: prepaidCardManager.contract.methods
          .sellCard(
            prepaidCards[2].address,
            walletOfIssuer.address,
            customer,
            await prepaidCardManager.appendPrepaidCardAdminSignature(
              walletOfIssuer.address,
              `0x000000000000000000000000${walletOfIssuer.address.replace(
                "0x",
                ""
              )}000000000000000000000000000000000000000000000000000000000000000001`
            )
          )
          .encodeABI(),
      },
    ];

    let payloads = encodeMultiSendCall(txs, multiSend);

    let safeTxData = {
      to: multiSend.address,
      value: 0,
      data: payloads,
      operation: 1,
      txGasEstimate: 0,
      baseGasEstimate: 0,
      gasPrice: 0,
      txGasToken: ZERO_ADDRESS,
      refundReceive: relayer,
    };

    let { safeTxHash, safeTx } = await signAndSendSafeTransaction(
      safeTxData,
      issuer,
      walletOfIssuer,
      relayer
    );

    let executeSuccess = getParamsFromEvent(
      safeTx,
      eventABIs.EXECUTION_SUCCESS,
      walletOfIssuer.address
    );
    expect(safeTxHash.toString()).to.be.equal(
      executeSuccess[executeSuccess.length - 1]["txHash"].toString()
    );
    expect(await prepaidCards[2].isOwner(customer)).to.be.equal(true);
    await shouldBeSameBalance(
      daicpxdToken,
      prepaidCards[2].address,
      toTokenUnit(5)
    );
  });
});
