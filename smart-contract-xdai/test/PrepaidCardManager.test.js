const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const DAICPXD = artifacts.require("DAICPXD.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("gnosisSafe");
const MultiSend = artifacts.require("MultiSend");

const utils = require("./utils/general");
const CREATE_PREPAID_CARD_TOPIC = utils.CREATE_PREPAID_CARD_TOPIC;
const ZERO_ADDRESS = utils.ZERO_ADDRESS;
const signer = utils.signer;
const encodeMultiSendCall = utils.encodeMultiSendCall;

contract("Test Prepaid Card Manager contract", (accounts) => {
	let daicpxdToken,
		revenuePool,
		spendToken,
		prepaidCardManager,
		multiSend,
		offChainId = "Id",
		fakeDaicpxdToken;
	let tally, supplier, customer, merchant, relayer, walletOfSupplier;
	let prepaidCards = [];

	before(async () => {
		tally = accounts[0];
		supplier = accounts[1];
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
		daicpxdToken = await DAICPXD.new(utils.toAmountToken("100", 2));
		// Deploy and mint 100 daicpxd token for deployer as owner
		fakeDaicpxdToken = await DAICPXD.new(utils.toAmountToken("100", 2));

		walletOfSupplier = await utils.getParamFromTxEvent(
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
			utils.toAmountToken("20", 2),
			{
				from: tally,
			}
		);

		// Transfer 20 daicpxd to supplier's wallet
		await fakeDaicpxdToken.transfer(
			walletOfSupplier.address,
			utils.toAmountToken("20", 2),
			{
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
		assert.ok(
			(await daicpxdToken.balanceOf(revenuePool.address)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(tally)).toString() ==
				utils.toAmountToken("80", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == utils.toAmountToken("20", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				utils.toAmountToken("8", 2),
				web3.eth.abi.encodeParameters(
					["address", "bytes"],
					[
						walletOfSupplier.address,
						web3.eth.abi.encodeParameters(
							["uint256[]"],
							[
								[
									utils.toAmountToken("1", 2).toString(),
									utils.toAmountToken("2", 2).toString(),
									utils.toAmountToken("5", 2).toString(),
								],
							]
						),
					]
				)
			)
			.encodeABI();

		const signature = await signer(
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
			signature,
			{ from: relayer }
		);
		let logs = tx.receipt.rawLogs
			.map((rawLog) => {
				if (rawLog.topics[0] === CREATE_PREPAID_CARD_TOPIC) {
					const log = web3.eth.abi.decodeLog(
						[
							{ type: "address", name: "supplier" },
							{ type: "address", name: "card" },
							{ type: "address", name: "token" },
							{ type: "uint256", name: "amount" },
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

		assert.ok(
			(await daicpxdToken.balanceOf(revenuePool.address)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(tally)).toString() ==
				utils.toAmountToken("80", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == utils.toAmountToken("12", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		let Owners = [
			walletOfSupplier.address,
			walletOfSupplier.address,
			walletOfSupplier.address,
		];
		let amounts = [
			utils.toAmountToken("1", 2),
			utils.toAmountToken("2", 2),
			utils.toAmountToken("5", 2),
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

	it("Supplier Create multi Prepaid Card fail when amount > supplier's balance", async () => {
		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				utils.toAmountToken("80", 2),
				web3.eth.abi.encodeParameters(
					["address", "bytes"],
					[
						walletOfSupplier.address,
						web3.eth.abi.encodeParameters(
							["uint256[]"],
							[
								[
									utils.toAmountToken("10", 2).toString(),
									utils.toAmountToken("20", 2).toString(),
									utils.toAmountToken("50", 2).toString(),
								],
							]
						),
					]
				)
			)
			.encodeABI();

		const signature = await signer(
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
			signature,
			{ from: relayer }
		);
		let logs = tx.receipt.rawLogs
			.map((rawLog) => {
				if (rawLog.topics[0] === CREATE_PREPAID_CARD_TOPIC) {
					const log = web3.eth.abi.decodeLog(
						[
							{ type: "address", name: "supplier" },
							{ type: "address", name: "card" },
							{ type: "address", name: "token" },
							{ type: "uint256", name: "amount" },
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
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(tally)).toString() ==
				utils.toAmountToken("80", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == utils.toAmountToken("12", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		let Owners = [
			walletOfSupplier.address,
			walletOfSupplier.address,
			walletOfSupplier.address,
		];
		let amounts = [
			utils.toAmountToken("1", 2),
			utils.toAmountToken("2", 2),
			utils.toAmountToken("5", 2),
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
				utils.toAmountToken("8", 2),
				web3.eth.abi.encodeParameters(
					["address", "bytes"],
					[
						walletOfSupplier.address,
						web3.eth.abi.encodeParameters(
							["uint256[]"],
							[
								[
									utils.toAmountToken("1", 2).toString(),
									utils.toAmountToken("2", 2).toString(),
									utils.toAmountToken("5", 2).toString(),
								],
							]
						),
					]
				)
			)
			.encodeABI();

		const signature = await signer(
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
			signature,
			{ from: relayer }
		);
		let logs = tx.receipt.rawLogs
			.map((rawLog) => {
				if (rawLog.topics[0] === CREATE_PREPAID_CARD_TOPIC) {
					const log = web3.eth.abi.decodeLog(
						[
							{ type: "address", name: "supplier" },
							{ type: "address", name: "card" },
							{ type: "address", name: "token" },
							{ type: "uint256", name: "amount" },
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
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(tally)).toString() ==
				utils.toAmountToken("80", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == utils.toAmountToken("12", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		let Owners = [
			walletOfSupplier.address,
			walletOfSupplier.address,
			walletOfSupplier.address,
		];
		let amounts = [
			utils.toAmountToken("1", 2),
			utils.toAmountToken("2", 2),
			utils.toAmountToken("5", 2),
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
		let txs = [
			{
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

		const signature = await signer(
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
			signature,
			{ from: relayer }
		);
		let logs = tx.receipt.rawLogs
			.map((rawLog) => {
				if (rawLog.topics[0] === CREATE_PREPAID_CARD_TOPIC) {
					const log = web3.eth.abi.decodeLog(
						[
							{ type: "address", name: "supplier" },
							{ type: "address", name: "card" },
							{ type: "address", name: "token" },
							{ type: "uint256", name: "amount" },
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
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(tally)).toString() ==
				utils.toAmountToken("80", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == utils.toAmountToken("12", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		let Owners = [
			walletOfSupplier.address,
			walletOfSupplier.address,
			customer,
		];
		let amounts = [
			utils.toAmountToken("1", 2),
			utils.toAmountToken("2", 2),
			utils.toAmountToken("5", 2),
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

		const signature = await signer(
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
				),
				{ from: relayer }
			);
		} catch (err) {
			canSellCard = false;
		}

		assert(canSellCard === false, "Can not sell card");

		assert.ok(
			(await daicpxdToken.balanceOf(revenuePool.address)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(prepaidCardManager.address)
			).toString() == utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(tally)).toString() ==
				utils.toAmountToken("80", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(supplier)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(
				await daicpxdToken.balanceOf(walletOfSupplier.address)
			).toString() == utils.toAmountToken("12", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(customer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(merchant)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		assert.ok(
			(await daicpxdToken.balanceOf(relayer)).toString() ==
				utils.toAmountToken("0", 2).toString()
		);

		let Owners = [
			walletOfSupplier.address,
			walletOfSupplier.address,
			customer,
		];
		let amounts = [
			utils.toAmountToken("1", 2),
			utils.toAmountToken("2", 2),
			utils.toAmountToken("5", 2),
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
