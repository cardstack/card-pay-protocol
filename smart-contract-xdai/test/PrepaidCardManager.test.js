const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const DAICPXD = artifacts.require("DAICPXD.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("gnosisSafe");
const MultiSend = artifacts.require("MultiSend");

const {
	keccak256
} = require("web3-utils");

const {
	signSafeTransaction,
	encodeMultiSendCall,
	ZERO_ADDRESS,
	CREATE_PREPAID_CARD_TOPIC,
	getParamFromTxEvent,
	encodeArray,
	getGnosisSafeFromEventLog
} = require("./utils/general");


const helper = require('./utils/helper');

const {TokenHelper} = require('./utils/helper');

contract("Test Prepaid Card Manager contract", (accounts) => {
	let daicpxdToken,
		revenuePool,
		spendToken,
		prepaidCardManager,
		multiSend,
		offChainId = "Id",
		fakeDaicpxdToken;
	let tally, supplier, customer, merchant, relayer, walletOfSupplier, supplierEOA;

	let daiHelper;
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
		daicpxdToken = await TokenHelper.deploy({TokenABIs: DAICPXD, args: [TokenHelper.toAmount(100, 2)]});

		// Deploy and mint 100 daicpxd token for deployer as owner
		fakeDaicpxdToken = await TokenHelper.deploy({TokenABIs: DAICPXD, args: [TokenHelper.toAmount(100, 2)]});

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
		let amounts = [
			TokenHelper.toAmount("1", 2),
			TokenHelper.toAmount("2", 2),
			TokenHelper.toAmount("5", 2),
		];

		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.toAmount("8", 2),
				web3.eth.abi.encodeParameters(
					["address", "bytes"],
					[
						walletOfSupplier.address,
						encodeArray([1, 2, 5], 2).toString()
					]
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

		let logs = tx.receipt.rawLogs
			.map((rawLog) => {
				if (rawLog.topics[0] === CREATE_PREPAID_CARD_TOPIC) {
					const log = web3.eth.abi.decodeLog(
						[{
								type: "address",
								name: "supplier"
							},
							{
								type: "address",
								name: "card"
							},
							{
								type: "address",
								name: "token"
							},
							{
								type: "uint256",
								name: "amount"
							},
						],
						rawLog.data,
						rawLog.topics
					);

					return log.card;
				}
			})
			.filter(Boolean);

		assert.ok(logs.length === 3, "Create 3 prepaid card");

		for (let i = 0; i < logs.length; ++i) {
			const prepaidCard = await GnosisSafe.at(logs[i]);
			prepaidCards.push(prepaidCard);
		}

		await helper.isEqualBalance(daicpxdToken, tally, TokenHelper.toAmount("60", 2))

		await helper.isEqualBalance(daicpxdToken, walletOfSupplier.address, TokenHelper.toAmount("12", 2));

		prepaidCards.forEach(async function (prepaidCard, index) {
			assert.ok(await prepaidCard.isOwner(walletOfSupplier.address))
			helper.isEqualBalance(daicpxdToken, prepaidCard.address, amounts[index]);
		})
	});

	it("Supplier Create multi Prepaid Card fail when amount > supplier's balance", async () => {
		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.toAmount("80", 2),
				web3.eth.abi.encodeParameters(
					["address", "bytes"],
					[
						walletOfSupplier.address,
						web3.eth.abi.encodeParameters(
							["uint256[]"],
							[
								[
									TokenHelper.toAmount("10", 2).toString(),
									TokenHelper.toAmount("20", 2).toString(),
									TokenHelper.toAmount("50", 2).toString(),
								],
							]
						),
					]
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
		let logs = tx.receipt.rawLogs
			.map((rawLog) => {
				if (rawLog.topics[0] === CREATE_PREPAID_CARD_TOPIC) {
					const log = web3.eth.abi.decodeLog(
						[{
								type: "address",
								name: "supplier"
							},
							{
								type: "address",
								name: "card"
							},
							{
								type: "address",
								name: "token"
							},
							{
								type: "uint256",
								name: "amount"
							},
						],
						rawLog.data,
						rawLog.topics
					);

					return log.card;
				}
			})
			.filter(Boolean);

		assert(logs.length === 0, "Create 0 prepaid card");

		for (let i = 0; i < logs.length; ++i) {
			const prepaidCard = await GnosisSafe.at(logs[i]);
			prepaidCards.push(prepaidCard);
		}

		assert.ok(
			(await daicpxdToken.balanceOf(revenuePool.address)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == TokenHelper.toAmount("12", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		let Owners = [
			walletOfSupplier.address,
			walletOfSupplier.address,
			walletOfSupplier.address,
		];
		let amounts = [
			TokenHelper.toAmount("1", 2),
			TokenHelper.toAmount("2", 2),
			TokenHelper.toAmount("5", 2),
		];
		for (let i = 0; i < prepaidCards.length; ++i) {
			assert((await prepaidCards[i].getOwners())[1] === Owners[i]);
			assert(
				(
					await daicpxdToken.balanceOf(prepaidCards[i].address)
				).toString() === amounts[i].toString()
			);
		}
	});

	it("Supplier create multi Prepaid Card fail with not allow payable token (1 daicpxd 2 daicpxd 5 daicpxd) ", async () => {
		let payloads = fakeDaicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.toAmount("8", 2),
				web3.eth.abi.encodeParameters(
					["address", "bytes"],
					[
						walletOfSupplier.address,
						web3.eth.abi.encodeParameters(
							["uint256[]"],
							[
								[
									TokenHelper.toAmount("1", 2).toString(),
									TokenHelper.toAmount("2", 2).toString(),
									TokenHelper.toAmount("5", 2).toString(),
								],
							]
						),
					]
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
		let logs = tx.receipt.rawLogs
			.map((rawLog) => {
				if (rawLog.topics[0] === CREATE_PREPAID_CARD_TOPIC) {
					const log = web3.eth.abi.decodeLog(
						[{
								type: "address",
								name: "supplier"
							},
							{
								type: "address",
								name: "card"
							},
							{
								type: "address",
								name: "token"
							},
							{
								type: "uint256",
								name: "amount"
							},
						],
						rawLog.data,
						rawLog.topics
					);

					return log.card;
				}
			})
			.filter(Boolean);

		assert(logs.length === 0, "Create 0 prepaid card");

		for (let i = 0; i < logs.length; ++i) {
			const prepaidCard = await GnosisSafe.at(logs[i]);
			prepaidCards.push(prepaidCard);
		}

		assert.ok(
			(await daicpxdToken.balanceOf(revenuePool.address)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == TokenHelper.toAmount("0", 2).toString()
		);


		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == TokenHelper.toAmount("12", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		let Owners = [
			walletOfSupplier.address,
			walletOfSupplier.address,
			walletOfSupplier.address,
		];

		let amounts = [
			TokenHelper.toAmount("1", 2),
			TokenHelper.toAmount("2", 2),
			TokenHelper.toAmount("5", 2),
		];

		for (let i = 0; i < prepaidCards.length; ++i) {
			assert((await prepaidCards[i].getOwners())[1] === Owners[i]);
			assert(
				(
					await daicpxdToken.balanceOf(prepaidCards[i].address)
				).toString() === amounts[i].toString()
			);
		}
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

		let logs = tx.receipt.rawLogs
			.map((rawLog) => {
				if (rawLog.topics[0] === CREATE_PREPAID_CARD_TOPIC) {
					const log = web3.eth.abi.decodeLog(
						[{
								type: "address",
								name: "supplier"
							},
							{
								type: "address",
								name: "card"
							},
							{
								type: "address",
								name: "token"
							},
							{
								type: "uint256",
								name: "amount"
							},
						],
						rawLog.data,
						rawLog.topics
					);

					return log.card;
				}
			})
			.filter(Boolean);

		assert(logs.length === 0, "Create 0 prepaid card");

		assert.ok(
			(await daicpxdToken.balanceOf(revenuePool.address)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == TokenHelper.toAmount("0", 2).toString()
		);



		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == TokenHelper.toAmount("12", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		let Owners = [
			walletOfSupplier.address,
			walletOfSupplier.address,
			customer,
		];
		let amounts = [
			TokenHelper.toAmount("1", 2),
			TokenHelper.toAmount("2", 2),
			TokenHelper.toAmount("5", 2),
		];

		for (let i = 0; i < prepaidCards.length; ++i) {
			assert((await prepaidCards[i].getOwners())[1] === Owners[i]);
			assert(
				(
					await daicpxdToken.balanceOf(prepaidCards[i].address)
				).toString() === amounts[i].toString()
			);
		}
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

		assert.ok(
			(await daicpxdToken.balanceOf(revenuePool.address)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == TokenHelper.toAmount("0", 2).toString()
		);


		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == TokenHelper.toAmount("12", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
			TokenHelper.toAmount("0", 2).toString()
		);

		let Owners = [
			walletOfSupplier.address,
			walletOfSupplier.address,
			customer,
		];
		let amounts = [
			TokenHelper.toAmount("1", 2),
			TokenHelper.toAmount("2", 2),
			TokenHelper.toAmount("5", 2),
		];
		for (let i = 0; i < prepaidCards.length; ++i) {
			assert((await prepaidCards[i].getOwners())[1] === Owners[i]);
			assert(
				(
					await daicpxdToken.balanceOf(prepaidCards[i].address)
				).toString() === amounts[i].toString()
			);
		}
	});
});