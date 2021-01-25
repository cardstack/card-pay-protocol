const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const ERC677Token = artifacts.require("ERC677Token.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("gnosisSafe");
const MultiSend = artifacts.require("MultiSend");


const eventABIs = require("./utils/constant/eventABIs");

const {
	signSafeTransaction,
	encodeMultiSendCall,
	ZERO_ADDRESS,
	getParamsFromEvent,
	getParamFromTxEvent,
	getGnosisSafeFromEventLog,
	padZero
} = require("./utils/general");

const {
	toTokenUnit,
	shouldSameBalance,
	encodeCreateCardsData,
	signAndSendSafeTransaction
} = require('./utils/helper');

const { expect, TOKEN_DETAIL_DATA, toBN } = require('./setup');

contract("Test Prepaid Card Manager contract", (accounts) => {

	let MINIMUN_AMOUNT, MAXIMUM_AMOUNT;
	let revenuePool, spendToken, cardManager, multiSend;
	let daicpxdToken, fakeDaicpxdToken;
	let gnosisSafeMasterCopy, proxyFactory;
	let tally, issuer, customer, merchant, relayer, depot, offChainId = "Id"

	let prepaidCards = [];

	before(async () => {
		tally = accounts[1];
		issuer = accounts[2];
		customer = accounts[3];
		merchantOwner = accounts[4];
		relayer = accounts[5];

		proxyFactory = await ProxyFactory.new();
		gnosisSafeMasterCopy = await GnosisSafe.new();
		revenuePool = await RevenuePool.new();
		cardManager = await PrepaidCardManager.new();
		multiSend = await MultiSend.new();

		// Deploy and mint 100 daicpxd token for deployer as owner
		daicpxdToken = await ERC677Token.new(...TOKEN_DETAIL_DATA)
		await daicpxdToken.mint(accounts[0], toTokenUnit(1000));

		// Deploy and mint 100 daicpxd token for deployer as owner
		fakeDaicpxdToken = await ERC677Token.new(...TOKEN_DETAIL_DATA);
		await fakeDaicpxdToken.mint(accounts[0], toTokenUnit(1000));

		let gnosisData = gnosisSafeMasterCopy.contract.methods
			.setup([issuer], 1, ZERO_ADDRESS, "0x", ZERO_ADDRESS, ZERO_ADDRESS, 0,ZERO_ADDRESS)
			.encodeABI()
		
		depot = await getParamFromTxEvent(
			await proxyFactory.createProxy(
				gnosisSafeMasterCopy.address,
				gnosisData
			),
			"ProxyCreation",
			"proxy",
			proxyFactory.address,
			GnosisSafe,
			"create Gnosis Safe Proxy"
		);

		MINIMUN_AMOUNT = 100 // in spend <=> 1 USD 
		MAXIMUM_AMOUNT = 500000 // in spend <=>  5000 USD
	})

	describe('#Setup contract (setup method)', () => {
		before(async () => {
			// create spendToken
			spendToken = await SPEND.new("SPEND Token", "SPEND", [
				revenuePool.address,
			]);

			// Setup for revenue pool
			await revenuePool.setup(
				tally,
				gnosisSafeMasterCopy.address,
				proxyFactory.address,
				spendToken.address,
				[daicpxdToken.address]
			);

			// Setup card manager contract
			await cardManager.setup(
				tally,
				gnosisSafeMasterCopy.address,
				proxyFactory.address,
				revenuePool.address,
				[daicpxdToken.address],
				MINIMUN_AMOUNT, MAXIMUM_AMOUNT
			);
		});

		it("should initialized parameters", async () => {
			expect(await cardManager.getTallys()).to.deep.equal([tally])
			expect(await cardManager.gnosisSafe()).to.deep.equal(gnosisSafeMasterCopy.address);
			expect(await cardManager.gnosisProxyFactory()).to.deep.equal(proxyFactory.address);
			expect(await cardManager.revenuePool()).to.deep.equal(revenuePool.address);
			expect(await cardManager.getTokens()).to.deep.equal([daicpxdToken.address]);
			expect(await cardManager.getMinimumAmount()).to.a.bignumber.equal(toBN(MINIMUN_AMOUNT));
			expect(await cardManager.getMaximumAmount()).to.a.bignumber.equal(toBN(MAXIMUM_AMOUNT));
		})

	})

	describe('#Create signature method', () => {
		it('Test signature view method', async () => {
			let contractSignature = padZero(cardManager.address, "0x") + padZero(ZERO_ADDRESS) + "01";
			await cardManager.getContractSignature().should.become(contractSignature.toLocaleLowerCase());


			let mockSign = padZero(customer, "0x") + padZero(ZERO_ADDRESS) + "01",
				expectSignture = mockSign + contractSignature.replace("0x", "");

			await cardManager.appendPrepaidCardAdminSignature(ZERO_ADDRESS, mockSign)
				.should.become(expectSignture.toLocaleLowerCase());

			expectSignture = contractSignature + mockSign.replace("0x", "");
			await cardManager.appendPrepaidCardAdminSignature(
				"0xffffffffffffffffffffffffffffffffffffffff",
				mockSign
			).should.become(expectSignture.toLocaleLowerCase())
		})

		it("Invalid signature", async () => {
			await cardManager.appendPrepaidCardAdminSignature(customer, "0x01")
				.should.be.rejectedWith(Error, "Invalid signature!");
		})

	})

	describe("#Create prepaid card", () => {

		let walletAmount;
		
		before(() => {
			walletAmount = toTokenUnit(100);
		})

		beforeEach(async () => {
			// mint 100 token for depot
			await daicpxdToken.mint(depot.address, walletAmount);
		});

		afterEach(async () => {
			// burn all token in depot wallet
			let balance = await daicpxdToken.balanceOf(depot.address);
			let data = daicpxdToken.contract.methods.burn(balance).encodeABI();

			let safeTxData = {
				to: daicpxdToken.address,
				data
			}

			await signAndSendSafeTransaction(
				safeTxData,
				issuer,
				depot,
				relayer
			);

			// burn all token in relayer wallet
			await daicpxdToken.burn(await daicpxdToken.balanceOf(relayer), { from: relayer });
		})

		it("should create prepaid card with balance is 1 token", async () => {
			let amount = toTokenUnit(1);

			let createCardData = encodeCreateCardsData(
				depot.address,
				[amount]
			)

			let transferAndCall = daicpxdToken.contract.methods
				.transferAndCall(
					cardManager.address,
					amount,
					createCardData
				);

			let payloads = transferAndCall.encodeABI();
			let gasEstimate = await transferAndCall.estimateGas()

			let safeTxData = {
				to: daicpxdToken.address,
				data: payloads,
				txGasEstimate: gasEstimate,
				gasPrice: 1000000000,
				txGasToken: daicpxdToken.address,
				refundReceive: relayer
			}

			let {
				safeTxHash,
				safeTx
			} = await signAndSendSafeTransaction(
				safeTxData,
				issuer,
				depot,
				relayer
			)

			let executeSuccess = getParamsFromEvent(safeTx, eventABIs.EXECUTION_SUCCESS, depot.address);

			expect(executeSuccess[0]).to.include({
				txHash: safeTxHash
			});

			let paymentActual = toBN(executeSuccess[0]['payment']);

			await shouldSameBalance(daicpxdToken, relayer, paymentActual);

			let prepaidCard = await getGnosisSafeFromEventLog(safeTx, cardManager.address);

			expect(prepaidCard).to.have.lengthOf(1);

			await prepaidCard[0].isOwner(depot.address).should.become(true);

			await cardManager.cardDetails(prepaidCard[0].address).should.eventually.to.include({
				issuer: depot.address,
				issueToken: daicpxdToken.address
			})

			await shouldSameBalance(daicpxdToken, prepaidCard[0].address, toTokenUnit(1));
			await shouldSameBalance(daicpxdToken, depot.address, walletAmount.sub(toTokenUnit(1)).sub(paymentActual));
		});

		it("Should create multi Prepaid Card (1 daicpxd 2 daicpxd 5 daicpxd) ", async () => {

			let amounts = [1, 2, 5].map(amount => toTokenUnit(amount));

			let createCardData = encodeCreateCardsData(
				depot.address,
				amounts
			);

			let payloads = daicpxdToken.contract.methods
				.transferAndCall(
					cardManager.address,
					toTokenUnit(8),
					createCardData
				).encodeABI();

			let gasEstimate = await daicpxdToken.contract.methods.
				transferAndCall(
					cardManager.address,
					toTokenUnit(8),
					createCardData
				).estimateGas()

			let safeTxData = {
				to: daicpxdToken.address,
				data: payloads,
				txGasEstimate: gasEstimate,
				gasPrice: 1000000000,
				txGasToken: daicpxdToken.address,
				refundReceive: relayer
			}

			let {
				safeTxHash,
				safeTx
			} = await signAndSendSafeTransaction(
				safeTxData,
				issuer,
				depot,
				relayer
			)

			prepaidCards = await getGnosisSafeFromEventLog(safeTx, cardManager.address);

			let executeSuccess = getParamsFromEvent(safeTx, eventABIs.EXECUTION_SUCCESS, depot.address);

			expect(executeSuccess[0]).to.include({
				txHash: safeTxHash
			})

			expect(prepaidCards).to.have.lengthOf(3, "Should create a new 3 cards(gnosis safe).");

			prepaidCards.forEach(async (prepaidCard, index) => {
				await cardManager.cardDetails(prepaidCard.address).should.eventually.to.include({
					issuer: depot.address,
					issueToken: daicpxdToken.address
				});

				await prepaidCard.isOwner(depot.address).should.become(true);
				await prepaidCard.isOwner(cardManager.address).should.become(true);

				shouldSameBalance(daicpxdToken, prepaidCard.address, amounts[index]);
			})

			let payment = toBN(executeSuccess[0]['payment']);

			await shouldSameBalance(
				daicpxdToken,
				depot.address,
				walletAmount.sub(toTokenUnit(8)).sub(payment)
			);

			await shouldSameBalance(daicpxdToken, relayer, payment);
		});

		it("Should not create card with value less than 1 token", async () => {

			let payloads = daicpxdToken.contract.methods
				.transferAndCall(
					cardManager.address,
					toTokenUnit(0),
					encodeCreateCardsData(depot.address, [toTokenUnit(0)])
				).encodeABI();

			let safeTxData = {
				to: daicpxdToken.address,
				data: payloads,
				txGasEstimate: 1000000,
				gasPrice: 1000000000,
				txGasToken: daicpxdToken.address,
				refundReceive: relayer
			}

			let {
				safeTxHash,
				safeTx
			} = await signAndSendSafeTransaction(
				safeTxData,
				issuer,
				depot,
				relayer
			)


			let executeFailed = getParamsFromEvent(safeTx, eventABIs.EXECUTION_FAILURE, depot.address);

			expect(executeFailed[0]).to.include({
				txHash: safeTxHash
			});

			let payment = toBN(executeFailed[0]['payment']);

			await shouldSameBalance(daicpxdToken, depot.address, walletAmount.sub(payment));
		})

		it("Should not create multi Prepaid Card fail when amount > issuer's balance", async () => {
			let amounts = [10, 20, 80].map(amount => toTokenUnit(amount));

			let payloads = daicpxdToken.contract.methods
				.transferAndCall(
					cardManager.address,
					toTokenUnit(80),
					encodeCreateCardsData(
						depot.address,
						amounts
					)
				)
				.encodeABI();

			let safeTxData = {
				to: daicpxdToken.address,
				data: payloads,
				txGasEstimate: 1000000,
				gasPrice: 1000000000,
				txGasToken: daicpxdToken.address,
				refundReceive: relayer
			}

			let {
				safeTxHash,
				safeTx
			} = await signAndSendSafeTransaction(
				safeTxData,
				issuer,
				depot,
				relayer
			)

			let executeFailed = getParamsFromEvent(safeTx, eventABIs.EXECUTION_FAILURE, depot.address);

			expect(executeFailed[0]).to.include({
				txHash: safeTxHash
			})

			let successPrepaidCards = await getGnosisSafeFromEventLog(safeTx);

			expect(successPrepaidCards).to.lengthOf(0);

			let payment = toBN(executeFailed[0]['payment']);

			await shouldSameBalance(daicpxdToken, depot.address, walletAmount.sub(payment));
			await shouldSameBalance(daicpxdToken, relayer, payment);
		});

		it('Should not create number card is zero', async () => {
			let payloads = daicpxdToken.contract.methods
				.transferAndCall(
					cardManager.address,
					toTokenUnit(7),
					encodeCreateCardsData(depot.address, [])
				).encodeABI();

			let safeTxData = {
				to: daicpxdToken.address,
				data: payloads,
				txGasEstimate: 1000000,
				gasPrice: 1000000000,
				txGasToken: daicpxdToken.address,
				refundReceive: relayer
			}

			let {
				safeTxHash,
				safeTx
			} = await signAndSendSafeTransaction(
				safeTxData,
				issuer,
				depot,
				relayer
			)


			let executeFailed = getParamsFromEvent(safeTx, eventABIs.EXECUTION_FAILURE, depot.address);

			expect(executeFailed[0]).to.include({
				txHash: safeTxHash
			});

			let successPrepaidCards = await getGnosisSafeFromEventLog(safeTx);

			expect(successPrepaidCards).to.lengthOf(0);

			let payment = toBN(executeFailed[0]['payment']);

			await shouldSameBalance(daicpxdToken, depot.address, walletAmount.sub(payment));

		})

		it("Should not allow create card from token is not payable token", async () => {
			let amounts = [1, 2, 5].map(amount => toTokenUnit(amount));

			let payloads = fakeDaicpxdToken.contract.methods
				.transferAndCall(
					cardManager.address,
					toTokenUnit(8),
					encodeCreateCardsData(
						depot.address,
						amounts
					)
				)
				.encodeABI();

			let safeTxData = {
				to: fakeDaicpxdToken.address,
				data: payloads,
				txGasEstimate: 1000000,
				gasPrice: 10000000000,
				txGasToken: daicpxdToken.address,
				refundReceive: relayer
			}

			let {
				safeTxHash,
				safeTx
			} = await signAndSendSafeTransaction(
				safeTxData,
				issuer,
				depot,
				relayer
			)

			let executeFailed = getParamsFromEvent(safeTx, eventABIs.EXECUTION_FAILURE, depot.address);

			expect(executeFailed[0]).to.include({
				txHash: safeTxHash
			})

			let payment = toBN(executeFailed[0]['payment']);

			await shouldSameBalance(daicpxdToken, depot.address, walletAmount.sub(payment));
			await shouldSameBalance(daicpxdToken, relayer, payment);
		});
	})



	describe("#Split prepaid card", () => {
		it("split card from 2 token to 2 card with 1 token for each", async () => {
			let amounts = [1, 1].map(amount => toTokenUnit(amount).toString());

			let splitCardData = [
				prepaidCards[1].address,
				depot.address,
				daicpxdToken.address,
				amounts,
			]


			let txs = [{
				to: prepaidCards[1].address,
				value: 0,
				data: prepaidCards[1].contract.methods
					.approveHash(
						await cardManager.getSplitCardHash(
							...splitCardData,
							await prepaidCards[1].nonce()
						)
					)
					.encodeABI(),
			},
			{
				to: cardManager.address,
				value: 0,
				data: cardManager.contract.methods
					.splitCard(
						...splitCardData,
						await cardManager.appendPrepaidCardAdminSignature(
							depot.address,
							`0x000000000000000000000000${depot.address.replace(
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
				data: payloads,
				operation: 1,
				relayer: accounts[0]
			}

			let {
				safeTxHash,
				safeTx
			} = await signAndSendSafeTransaction(
				safeTxData,
				issuer,
				depot,
				relayer
			);

			let executeSuccess = getParamsFromEvent(safeTx, eventABIs.EXECUTION_SUCCESS, depot.address);

			expect(executeSuccess[0]).to.include({
				txHash: safeTxHash
			})


			let cards = await getGnosisSafeFromEventLog(safeTx, cardManager.address);
			expect(cards).to.have.lengthOf(2);

			cards.forEach(async (prepaidCard, index) => {
				await cardManager.cardDetails(prepaidCard.address).should.eventually.to.include({
					issuer: depot.address,
					issueToken: daicpxdToken.address
				});

				await prepaidCard.isOwner(depot.address).should.become(true);
				await prepaidCard.isOwner(cardManager.address).should.become(true);

				shouldSameBalance(daicpxdToken, prepaidCard.address, amounts[index]);
			})
		})
	})

	describe("#Sell card for customer", () => {
		let signatures, cardAddress;
		before(async () => {
			signatures = await cardManager.appendPrepaidCardAdminSignature(
				depot.address,
				`0x000000000000000000000000${depot.address.replace(
					"0x",
					""
				)}000000000000000000000000000000000000000000000000000000000000000001`
			);
			cardAddress = prepaidCards[2].address;
		})

		it("should be sell the card with 5 daicpxd to customer", async () => {

			let cardSales = [cardAddress, depot.address, customer];
			let currentNonce = await prepaidCards[2].nonce();

			let sellCardHash = await cardManager.getSellCardHash(...cardSales, currentNonce)

			let approveHashBytecode = prepaidCards[2].contract.methods
				.approveHash(sellCardHash).encodeABI();

			let sellCardBytecode = cardManager.contract.methods
				.sellCard(...cardSales, signatures).encodeABI();

			let txs = [
				{
					to: cardAddress,
					value: 0,
					data: approveHashBytecode
				},
				{
					to: cardManager.address,
					value: 0,
					data: sellCardBytecode
				},
			];

			let payloads = encodeMultiSendCall(txs, multiSend);

			let safeTxData = {
				to: multiSend.address,
				data: payloads,
				operation: 1,
				refundReceive: relayer
			}

			let {
				safeTxHash,
				safeTx
			} = await signAndSendSafeTransaction(
				safeTxData,
				issuer,
				depot,
				relayer
			)

			let executeSuccess = getParamsFromEvent(safeTx, eventABIs.EXECUTION_SUCCESS, depot.address);

			expect(executeSuccess[0]).to.include({ txHash: safeTxHash });

			await prepaidCards[2].isOwner(customer).should.eventually.become(true);

			await shouldSameBalance(daicpxdToken, cardAddress, toTokenUnit(5));
		});

		it("Should not sell card with 5 daicpxd (prepaidCards[2]) to another customer", async () => {
			let otherCustomer = accounts[0];

			let payloads = prepaidCards[2].contract.methods.swapOwner(
				cardManager.address,
				customer,
				otherCustomer
			).encodeABI();

			const signature = await signSafeTransaction(
				cardManager.address,
				0,
				payloads.toString(),
				0,
				0,
				0,
				0,
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				await prepaidCards[2].nonce(),
				customer,
				prepaidCards[2]
			);

			let signatures = await cardManager.appendPrepaidCardAdminSignature(
				customer,
				signature
			);

			await cardManager.sellCard(cardAddress, customer,
				otherCustomer,
				signatures,
				{
					from: relayer
				}
			).should.be.rejected;
		});

	})

	describe('#Use prepaid card for payment', () => {
		let cardAddress;
		before(async () => {
			let merchantTx = await revenuePool.registerMerchant(merchantOwner, offChainId, {
				from: tally
			});
			let merchantCreation = await getParamsFromEvent(merchantTx, eventABIs.MERCHANT_CREATION, revenuePool.address);
			merchant = merchantCreation[0]['merchant'];

			cardAddress = prepaidCards[2].address;
		})


		it("Customer payment for merchant", async () => {
			let data = await cardManager.getPayData(
				daicpxdToken.address,
				merchant,
				toTokenUnit(1)
			).should.be.fulfilled;

			let signature = await signSafeTransaction(
				daicpxdToken.address,
				0,
				data,
				0,
				0,
				0,
				0,
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				await prepaidCards[2].nonce(),
				customer,
				prepaidCards[2]
			)

			let signatures = await cardManager.appendPrepaidCardAdminSignature(
				customer,
				signature
			).should.be.fulfilled;

			await cardManager.payForMerchant(
				cardAddress,
				daicpxdToken.address,
				merchant,
				toTokenUnit(1),
				signatures,
				{ from: relayer }
			).should.be.fulfilled;

			await shouldSameBalance(daicpxdToken, revenuePool.address, toTokenUnit(1));
			await shouldSameBalance(daicpxdToken, cardAddress, toTokenUnit(4));
		})


		it("Customer payment for merchant failed", async () => {
			let data = await cardManager.getPayData(
				daicpxdToken.address,
				merchant,
				toTokenUnit(10)
			).should.be.fulfilled;

			let signature = await signSafeTransaction(
				daicpxdToken.address,
				0,
				data,
				0,
				0,
				0,
				0,
				ZERO_ADDRESS,
				ZERO_ADDRESS,
				await prepaidCards[2].nonce(),
				customer,
				prepaidCards[2]
			)

			let signatures = await cardManager.appendPrepaidCardAdminSignature(
				customer,
				signature
			);

			await cardManager.payForMerchant(
				cardAddress,
				daicpxdToken.address,
				merchant,
				toTokenUnit(10),
				signatures,
				{ from: relayer }
			).should.be.rejected;


			await shouldSameBalance(daicpxdToken, revenuePool.address, toTokenUnit(1));
			await shouldSameBalance(daicpxdToken, cardAddress, toTokenUnit(4));
		})
	})

	describe('#Role test', () => {
		it("Tally role", async () => {
			let newTally = accounts[8];
			await cardManager.removeTally(tally).should.be.fulfilled;
			await cardManager.addTally(newTally).should.be.fulfilled;

			await cardManager.getTallys().should.become([newTally]);

		})

		it("Payable token add and remove", async () => {
			let mockPayableTokenAddr = accounts[9];

			await cardManager.addPayableToken(mockPayableTokenAddr).should.be.fulfilled;

			await cardManager.removePayableToken(daicpxdToken.address).should.be.fulfilled;

			await cardManager.getTokens().should.become([mockPayableTokenAddr])
		})
	})
});