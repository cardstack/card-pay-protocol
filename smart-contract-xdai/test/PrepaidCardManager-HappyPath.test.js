const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const DAICPXD = artifacts.require("DAICPXD.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("gnosisSafe");
const MultiSend = artifacts.require("MultiSend");


const { toBN, toHex } = require("web3-utils");
const eventABIs = require("./utils/constant/eventABIs");
const {
	signSafeTransaction,
	encodeMultiSendCall,
	ZERO_ADDRESS,
	EXECUTE_EVENT_FAILED,
	EXECUTE_EVENT_SUCCESS,
	EXECUTE_EVENT_META,
	getParamsFromEvent,
	getParamFromTxEvent,
	getGnosisSafeFromEventLog
} = require("./utils/general");


const {
	TokenHelper,
	ContractHelper
} = require('./utils/helper');


contract("Test Prepaid Card Manager contract", (accounts) => {
	const tokenMeta = ["DAICPXD Token", "DAICPXD", 18]

	let daicpxdToken,
		revenuePool,
		spendToken,
		prepaidCardManager,
		multiSend,
		offChainId = "Id",
		fakeDaicpxdToken;
	let tally, issuer, customer, merchant, relayer, walletOfIssuer;

	let prepaidCards = [];
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
		spendToken = await SPEND.new("SPEND Token", "SPEND", [
			revenuePool.address,
		]);

		// Deploy and mint 100 daicpxd token for deployer as owner
		daicpxdToken = await TokenHelper.deploy({
			TokenABIs: DAICPXD,
			args: [...tokenMeta, TokenHelper.amountOf(100)]
		});

		// Deploy and mint 100 daicpxd token for deployer as owner
		fakeDaicpxdToken = await TokenHelper.deploy({
			TokenABIs: DAICPXD,
			args: [...tokenMeta, TokenHelper.amountOf(100)]
		});

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
		await daicpxdToken.transfer(
			walletOfIssuer.address,
			TokenHelper.amountOf(20), {
				from: tally,
			}
		);
 
		// Transfer 20 daicpxd to issuer's wallet
		await fakeDaicpxdToken.transfer(
			walletOfIssuer.address,
			TokenHelper.amountOf(20), {
				from: tally,
			}
		);


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
			[daicpxdToken.address]
		);

		prepaidCardManagerSignature = await prepaidCardManager.getContractSignature();
	});

	it("#1 Shows issuer Creating Cards ", async () => {
		let oldWalletBalance = await daicpxdToken.balanceOf(walletOfIssuer.address);
		let oldRelayerBalance = await daicpxdToken.balanceOf(relayer)
		let amounts = [1, 2, 5].map(amount => TokenHelper.amountOf(amount));

		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.amountOf(8),
				ContractHelper.encodeCreateCardsData(
					walletOfIssuer.address,
					amounts
				)
			)
			.encodeABI();

		let gasEstimate = await daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.amountOf(8),
				ContractHelper.encodeCreateCardsData(
					walletOfIssuer.address,
					amounts
				)
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
			refundReceive: relayer
		}

		let {
			safeTxHash,
			safeTx
		} = await ContractHelper.signAndSendSafeTransactionByRelayer(
			safeTxData,
			issuer,
			walletOfIssuer,
			relayer
		)

		prepaidCards = await getGnosisSafeFromEventLog(safeTx, prepaidCardManager.address);

		let executeSuccess = getParamsFromEvent(safeTx, eventABIs.EXECUTION_SUCCESS, walletOfIssuer.address);

		assert.equal(
			safeTxHash.toString(),
			executeSuccess[executeSuccess.length - 1]['txHash'].toString(),
			"The event execute success should exist."
		);

		assert.equal(prepaidCards.length, 3, "Should create a new 3 cards(gnosis safe).");

		prepaidCards.forEach(async function (prepaidCard, index) {
			assert.isTrue(await prepaidCard.isOwner(walletOfIssuer.address))
			assert.isTrue(await prepaidCard.isOwner(prepaidCardManager.address))
			TokenHelper.isEqualBalance(daicpxdToken, prepaidCard.address, amounts[index]);
		})

		let payment = toBN(executeSuccess[executeSuccess.length - 1]['payment']);
		await TokenHelper.isEqualBalance(
			daicpxdToken, 
			walletOfIssuer.address,
			oldWalletBalance.sub(payment).sub(toBN(TokenHelper.amountOf(8)))
		);

		await TokenHelper.isEqualBalance(daicpxdToken, relayer, oldRelayerBalance.add(payment));
	});


	it("#2 Issure transfering the card to a customer ", async () => {
		let txs = [{
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
			refundReceive: relayer
		}

		let {
			safeTxHash,
			safeTx
		} = await ContractHelper.signAndSendSafeTransactionByRelayer(
			safeTxData,
			issuer,
			walletOfIssuer,
			relayer
		)

		let executeSuccess = getParamsFromEvent(safeTx, eventABIs.EXECUTION_SUCCESS, walletOfIssuer.address);
		assert.equal(safeTxHash.toString(), executeSuccess[executeSuccess.length - 1]['txHash'].toString());
		assert.isTrue(await prepaidCards[2].isOwner(customer));
		await TokenHelper.isEqualBalance(daicpxdToken, prepaidCards[2].address, TokenHelper.amountOf(5));
	});
});