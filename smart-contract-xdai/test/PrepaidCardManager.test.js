const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const DAICPXD = artifacts.require("DAICPXD.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("gnosisSafe");
const MultiSend = artifacts.require("MultiSend");

const AbiCoder = require('web3-eth-abi');

const {
	keccak256
} = require("web3-utils");

const {
	signSafeTransaction,
	encodeMultiSendCall,
	ZERO_ADDRESS,
	CREATE_PREPAID_CARD_TOPIC,
	EXECUTE_EVENT_FAILED,
	EXECUTE_EVENT_SUCCESS,
	EXECUTE_EVENT_META,
	getParamsFromEvent,
	encodeArray,
	getParamFromTxEvent,
	getGnosisSafeFromEventLog
} = require("./utils/general");


const helper = require('./utils/helper');

const {
	TokenHelper,
	ContractHelper
} = require('./utils/helper');

contract("Test Prepaid Card Manager contract", (accounts) => {
	let daicpxdToken,
		revenuePool,
		spendToken,
		prepaidCardManager,
		multiSend,
		offChainId = "Id",
		fakeDaicpxdToken;
	let tally, supplier, customer, merchant, relayer, walletOfSupplier, supplierEOA;

	let prepaidCards = [];

	before(async () => {
		tally = accounts[0];
		supplier = accounts[1];
		customer = accounts[2];
		merchant = accounts[3];
		relayer = accounts[4];
		supplierEOA = accounts[8];

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
			args: [TokenHelper.toAmount(100, 2)]
		});

		// Deploy and mint 100 daicpxd token for deployer as owner
		fakeDaicpxdToken = await TokenHelper.deploy({
			TokenABIs: DAICPXD,
			args: [TokenHelper.toAmount(100, 2)]
		});

		walletOfSupplier = await getParamFromTxEvent(
			await proxyFactory.createProxy(
				gnosisSafeMasterCopy.address,
				gnosisSafeMasterCopy.contract.methods
				.setup(
					[supplier],
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

		// Transfer 20 daicpxd to supplier's wallet
		await daicpxdToken.transfer(
			walletOfSupplier.address,
			TokenHelper.toAmount(20, 2), {
				from: tally,
			}
		);

		// Transfer 20 daicpxd to supplier's wallet
		await fakeDaicpxdToken.transfer(
			walletOfSupplier.address,
			TokenHelper.toAmount(20, 2), {
				from: tally,
			}
		);

		await daicpxdToken.transfer(supplierEOA, TokenHelper.toAmount('20', 2), {
			from: tally
		});

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

	it("Supplier create multi Prepaid Card (1 daicpxd 2 daicpxd 5 daicpxd) ", async () => {
		let amounts = [1, 2, 5].map(amount => TokenHelper.toAmount(amount, 2));

		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.toAmount("8", 2),
				ContractHelper.prepageDataForCreateMutipleToken(
						walletOfSupplier.address,
						amounts
				)
			)
			.encodeABI();

		const signature = await signSafeTransaction(
			daicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			await walletOfSupplier.nonce.call(),
			supplier,
			walletOfSupplier
		);

		let tx = await walletOfSupplier.execTransaction(
			daicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			signature, {
				from: relayer
			}
		);

		 
		prepaidCards = await getGnosisSafeFromEventLog(tx);

		assert.ok(prepaidCards.length === 3, "Create 3 prepaid card");

		await TokenHelper.isEqualBalance(daicpxdToken, tally, TokenHelper.toAmount("60", 2))

		await TokenHelper.isEqualBalance(daicpxdToken, walletOfSupplier.address, TokenHelper.toAmount("12", 2));

		prepaidCards.forEach(async function (prepaidCard, index) {
			assert.ok(await prepaidCard.isOwner(walletOfSupplier.address))
			assert.ok(await prepaidCard.isOwner(prepaidCardManager.address))
			TokenHelper.isEqualBalance(daicpxdToken, prepaidCard.address, amounts[index]);
		})

	});

	it("Supplier Create multi Prepaid Card fail when amount > supplier's balance", async () => {

		let amounts = [10, 20, 80].map(amount => TokenHelper.toAmount(amount, 2));
		
		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.toAmount(80, 2),
				ContractHelper.prepageDataForCreateMutipleToken(
					walletOfSupplier.address,
					amounts
				)
			)
			.encodeABI();

		const signature = await signSafeTransaction(
			daicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			await walletOfSupplier.nonce.call(),
			supplier,
			walletOfSupplier
		);
		
		let txHash = await walletOfSupplier.getTransactionHash(
			daicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			await walletOfSupplier.nonce.call()
		);

		let tx = await walletOfSupplier.execTransaction(
			daicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			signature, {
				from: relayer
			}
		);
		
		let executeFailed = getParamsFromEvent(tx, EXECUTE_EVENT_FAILED, EXECUTE_EVENT_META);
		assert.equal(txHash.toString(), executeFailed[0]['txHash'].toString());

		let successPrepaidCards = await getGnosisSafeFromEventLog(tx);
		assert.equal(successPrepaidCards.length, 0);
		
		TokenHelper.isEqualBalance(daicpxdToken, walletOfSupplier.address, TokenHelper.toAmount(12,2))
	});

	it('supplier create number card is zero', async () => {

		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.toAmount(7, 2),
				ContractHelper.prepageDataForCreateMutipleToken(walletOfSupplier.address, [])
			).encodeABI();

		let txHash = await walletOfSupplier.getTransactionHash(
			daicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			await walletOfSupplier.nonce.call()
		);

		const signature = await signSafeTransaction(
			daicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			await walletOfSupplier.nonce.call(),
			supplier,
			walletOfSupplier
		);

		let tx = await walletOfSupplier.execTransaction(
			daicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			signature, {
				from: relayer
			}
		);

		let executeFailed = getParamsFromEvent(tx, EXECUTE_EVENT_FAILED, EXECUTE_EVENT_META);
		assert.ok(Array.isArray(executeFailed) && executeFailed.length > 0)
		assert.deepEqual(txHash.toString(), executeFailed[0]['txHash']);
		TokenHelper.isEqualBalance(daicpxdToken, walletOfSupplier.address, TokenHelper.toAmount(12, 2));
	})

	it("Supplier create multi Prepaid Card fail with not allow payable token (1 daicpxd 2 daicpxd 5 daicpxd) ", async () => {
		let amounts = [1, 2, 5].map(amount => TokenHelper.toAmount(amount, 2));

		let payloads = fakeDaicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.toAmount("8", 2),
				ContractHelper.prepageDataForCreateMutipleToken(
					walletOfSupplier.address,
					amounts
				)
			)
			.encodeABI();

		const signature = await signSafeTransaction(
			fakeDaicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			await walletOfSupplier.nonce.call(),
			supplier,
			walletOfSupplier
		);

		let txHash = await walletOfSupplier.getTransactionHash(
			fakeDaicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			await walletOfSupplier.nonce.call()
		);

		let tx = await walletOfSupplier.execTransaction(
			fakeDaicpxdToken.address,
			0,
			payloads,
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			signature, {
				from: relayer
			}
		);
		let executeFailed = getParamsFromEvent(tx, EXECUTE_EVENT_FAILED, EXECUTE_EVENT_META);
		assert.equal(txHash.toString(), executeFailed[0]['txHash'].toString());

		let successPrepaidCards = await getGnosisSafeFromEventLog(tx);
		assert.equal(successPrepaidCards.length, 0);
		
		TokenHelper.isEqualBalance(daicpxdToken, walletOfSupplier.address, TokenHelper.toAmount(12,2))
	});

	it("Supplier sell card with 5 daicpxd (prepaidCards[2]) to customer", async () => {
		let txs = [{
				to: prepaidCards[2].address,
				value: 0,
				data: prepaidCards[2].contract.methods
					.approveHash(
						await prepaidCardManager.getSellCardHash(
							prepaidCards[2].address,
							walletOfSupplier.address,
							customer,
							(await prepaidCards[2].nonce.call()).toNumber()
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
						walletOfSupplier.address,
						customer,
						await prepaidCardManager.appendPrepaidCardAdminSignature(
							walletOfSupplier.address,
							`0x000000000000000000000000${walletOfSupplier.address.replace(
								"0x",
								""
							)}000000000000000000000000000000000000000000000000000000000000000001`
						)
					)
					.encodeABI(),
			},
		];

		let payloads = encodeMultiSendCall(txs, multiSend);

		const signature = await signSafeTransaction(
			multiSend.address,
			0,
			payloads,
			1,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			await walletOfSupplier.nonce.call(),
			supplier,
			walletOfSupplier
		);

		let txHash = await walletOfSupplier.getTransactionHash(
			multiSend.address,
			0,
			payloads,
			1,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			await walletOfSupplier.nonce.call()
		);

		let tx = await walletOfSupplier.execTransaction(
			multiSend.address,
			0,
			payloads,
			1,
			0,
			0,
			0,
			ZERO_ADDRESS,
			relayer,
			signature, {
				from: relayer
			}
		);
		
		
		let executeSuccess= getParamsFromEvent(tx, EXECUTE_EVENT_SUCCESS, EXECUTE_EVENT_META);
		assert.equal(txHash.toString(), executeSuccess[executeSuccess.length - 1]['txHash'].toString());
		
		assert.isTrue(await prepaidCards[2].isOwner(customer)); 
		TokenHelper.isEqualBalance(daicpxdToken, prepaidCards[2].address, TokenHelper.toAmount(5, 2));
	});

	it("Customer can not sell card with 5 daicpxd (prepaidCards[2]) to another customer", async () => {
		let otherCustomer = merchant;

		let payloads;

		let canGetSellCardData = true;
		try {
			payloads = await prepaidCardManager.getSellCardData(
				prepaidCards[2].address,
				customer,
				otherCustomer
			);
		} catch (err) {
			canGetSellCardData = false;
		}

		assert(canGetSellCardData === false, "Can not getSellCardData");

		payloads = prepaidCards[2].contract.methods.swapOwner(
			prepaidCardManager.address,
			customer,
			otherCustomer
		);

		const signature = await signSafeTransaction(
			prepaidCardManager.address,
			0,
			payloads.toString(),
			0,
			0,
			0,
			0,
			ZERO_ADDRESS,
			ZERO_ADDRESS,
			await prepaidCards[2].nonce.call(),
			customer,
			prepaidCards[2]
		);

		let canSellCard = true;
		try {
			await prepaidCardManager.sellCard(
				prepaidCards[2].address,
				prepaidCards[2].address,
				customer,
				otherCustomer,
				await prepaidCardManager.appendPrepaidCardAdminSignature(
					customer,
					signature
				), {
					from: relayer
				}
			);
		} catch (err) {
			canSellCard = false;
		}

		assert(canSellCard === false, "Can not sell card");

	});

});