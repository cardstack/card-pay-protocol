const utils = require('./utils/general')
const safeUtils = require('./utils/execution')
const ethUtil = require('ethereumjs-util')
const abi = require('ethereumjs-abi')




const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const DAICPXD = artifacts.require("DAICPXD.sol");
const SPEND = artifacts.require("SPEND.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("gnosisSafe");
const MultiSend = artifacts.require("MultiSend");


const { toBN, toHex } = require("web3-utils");
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
const eventABIs = require('./utils/constant/eventABIs');


contract("Test Prepaid Card Manager contract", (accounts) => {

	const tokenMeta = ["DAICPXD Token", "DAICPXD", 18]

	let daicpxdToken,
		revenuePool,
		spendToken,
		prepaidCardManager,
		multiSend,
		offChainId = "Id",
		fakeDaicpxdToken,
		proxyFactory,
		gnosisSafeMasterCopy,
		/// addresses 
	    tally, 
	    supplier1, 
	    supplier2, 
	    customer, 
	    merchant1,
	    merchant2,
	    merchant3,
	    merchant4,
	    merchant5, 
	    relayer,
	    walletOfSupplier1,
	    walletOfSupplier2,
	    walletOfSupplier_zero_balance;
	    
	    

	   let prepaidCards = [];



	before(async () => {

		tally = accounts[0];
		supplier1 = accounts[1];
		supplier2 = accounts[2];
		customer = accounts[3];
		relayer = accounts[4];
		false_relayer = accounts[5];

		// assign merchant accounts
		merchant1 = accounts[6];
		merchant2 = accounts[7];
		merchant3 = accounts[8];
		merchant4 = accounts[9];
		 

		 proxyFactory = await ProxyFactory.new();
		 gnosisSafeMasterCopy = await GnosisSafe.new();

	
	 


	 


		// Deploy and mint 500 daicpxd token for deployer as owner
		daicpxdToken = await TokenHelper.deploy({
			TokenABIs: DAICPXD,
			args: [...tokenMeta, TokenHelper.amountOf(500)]
		});

		// Deploy and mint 500 daicpxd token for deployer as owner

		fakeDaicpxdToken = await TokenHelper.deploy({
			TokenABIs: DAICPXD,
			args: [...tokenMeta, TokenHelper.amountOf(500)]
		});


		  
         let balance =  await TokenHelper.getBalance(fakeDaicpxdToken,fakeDaicpxdToken.address); 
            console.log("AAA " +balance)  ;

      

        // setup MultiSend
        multiSend = await MultiSend.new();
		
        // setup the revenue pool 
        revenuePool = await RevenuePool.new();

        // create spend token
		spendToken = await SPEND.new("SPEND Token", "SPEND", [
			revenuePool.address,
		]);
	
		await revenuePool.setup(
			tally,
			gnosisSafeMasterCopy.address,
			proxyFactory.address,
			spendToken.address,
			[daicpxdToken.address]
		);

		// setup the card manager
        prepaidCardManager = await PrepaidCardManager.new();
		await prepaidCardManager.setup(
			tally,
			gnosisSafeMasterCopy.address,
			proxyFactory.address,
			revenuePool.address,
			[daicpxdToken.address]
		);
		

	 
        // fetch the signiture
		prepaidCardManagerSignature = await prepaidCardManager.getContractSignature();

		//register the first merchant

		 await revenuePool.registerMerchant(merchant1, offChainId);


		 		walletOfSupplier1 = await getParamFromTxEvent(
			await proxyFactory.createProxy(
				gnosisSafeMasterCopy.address,
				gnosisSafeMasterCopy.contract.methods
				.setup(
					[supplier1],
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
			walletOfSupplier1.address,
			TokenHelper.amountOf(20), {
				from: tally,
			}
		);
 
		// Transfer 20 daicpxd to supplier's wallet
		await fakeDaicpxdToken.transfer(
			walletOfSupplier1.address,
			TokenHelper.amountOf(20), {
				from: tally,
			}
		)

		 walletOfSupplier2 = await getParamFromTxEvent(
			await proxyFactory.createProxy(
				gnosisSafeMasterCopy.address,
				gnosisSafeMasterCopy.contract.methods
				.setup(
					[supplier1],
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
			walletOfSupplier2.address,
			TokenHelper.amountOf(20), {
				from: tally,
			}
		);
 
		// Transfer 20 daicpxd to supplier's wallet
		await fakeDaicpxdToken.transfer(
			walletOfSupplier2.address,
			TokenHelper.amountOf(20), {
				from: tally,
			}
		)


				walletOfSupplier_zero_balance= await getParamFromTxEvent(
			await proxyFactory.createProxy(
				gnosisSafeMasterCopy.address,
				gnosisSafeMasterCopy.contract.methods
				.setup(
					[supplier1],
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
		// await daicpxdToken.transfer(
		// 	walletOfSupplier_zero_balance.address,
		// 	TokenHelper.amountOf(20), {
		// 		from: tally,
		// 	}
		// );
 
		// // Transfer 20 daicpxd to supplier's wallet
		// await fakeDaicpxdToken.transfer(
		// 	walletOfSupplier_zero_balance.address,
		// 	TokenHelper.amountOf(20), {
		// 		from: tally,
		// 	}
		// )	 // dont send token;


	});

 



    beforeEach(async function () 
    {

 

 
        
    })



     it('Issuer Creates a new Wallet ', async () => {

		let amountBefore = await daicpxdToken.balanceOf(walletOfSupplier1.address);

		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.amountOf(7),
				// using wallet of supplyer 1
				ContractHelper.encodeCreateCardsData(walletOfSupplier2.address, [])
			).encodeABI();



		let safeTxData = {
			to: daicpxdToken.address,
			value: 0,
			data: payloads,
			operation: 0,
			txGasEstimate: 1000000,
			baseGasEstimate: 0,
			gasPrice: 1000000000,
			txGasToken: daicpxdToken.address,
			refundReceive: relayer
		}

		let safeTxArr = Object.keys(safeTxData).map(key => safeTxData[key])

        let nonce = await walletOfSupplier1.nonce();
        // sign data with nonce by owner and gnosisSafe
        let signature = await signSafeTransaction(...safeTxArr, nonce, supplier2, walletOfSupplier1);

        // compute txHash of transaction
        let safeTxHash = await walletOfSupplier1.getTransactionHash(...safeTxArr, nonce);
 	try {

 		  let safeTx = await walletOfSupplier2.execTransaction(...safeTxArr, signature, {
            from: relayer
        });
			  
		} catch (err) {
            assert.equal(err.reason, "Invalid owner provided");
		}
        // send transaction to network
      

 

  
    })


     it('lets try putting a phony address as the relayer address', async () => {


     
      
		let payloads = daicpxdToken.contract.methods
			.transferAndCall(
				prepaidCardManager.address,
				TokenHelper.amountOf(7),
				ContractHelper.encodeCreateCardsData(walletOfSupplier2.address, [7])
			).encodeABI();

			let safeTxData = {
			to: daicpxdToken.address,
			value: 0,
			data: payloads,
			operation: 0,
			txGasEstimate: 1000000,
			baseGasEstimate: 0,
			gasPrice: 1000000000,
			txGasToken: daicpxdToken.address,
			refundReceive: false_relayer
		}



		let safeTxArr = Object.keys(safeTxData).map(key => safeTxData[key])

        let nonce = await walletOfSupplier2.nonce();
        // sign data with nonce by owner and gnosisSafe
        let signature = await signSafeTransaction(...safeTxArr, nonce, supplier1, walletOfSupplier2);

        // compute txHash of transaction
        let safeTxHash = await walletOfSupplier2.getTransactionHash(...safeTxArr, nonce);

        // send transaction to network
        let safeTx = await walletOfSupplier2.execTransaction(...safeTxArr, signature, {
            from: relayer
        });

		let executeFailed = getParamsFromEvent(safeTx, eventABIs.EXECUTION_FAILURE, walletOfSupplier2);
		

		// we should not have been able to use a false relayer.

		let relayerBalance = await daicpxdToken.balanceOf(false_relayer)
		console.log('RELAYER BALQNCE' + relayerBalance);

		 assert(false);
    })

    


 

       

	// it("Supplier create prepaid card have amount = 1 token DAI CPXD ", async () => {

	// 	let payloads = daicpxdToken.contract.methods
	// 		.transferAndCall(
	// 			prepaidCardManager.address,
	// 			TokenHelper.amountOf(1),
	// 			ContractHelper.prepareDataForCreateMutipleToken(
	// 				walletOfSupplier.address, 
 //                    [TokenHelper.amountOf(1)]
	// 			)
	// 		)
	// 		.encodeABI();

	// 	let safeTxData = {
	// 		to: daicpxdToken.address,
	// 		value: 0,
	// 		data: payloads,
	// 		operation: 0,
	// 		txGasEstimate: 1000000,
	// 		baseGasEstimate: 0,
	// 		gasPrice: 1000000000,
	// 		txGasToken: daicpxdToken.address,
	// 		refundReceive: relayer
	// 	}

	// 	let {
	// 		safeTxHash,
	// 		safeTx
	// 	} = await ContractHelper.signAndSendSafeTransactionByRelayer(
	// 		safeTxData,
	// 		supplier,
	// 		walletOfSupplier,
	// 		relayer
	// 	)

	// 	let executeSuccess = getParamsFromEvent(safeTx, EXECUTE_EVENT_SUCCESS, EXECUTE_EVENT_META);
	// 	assert.equal(
	// 		safeTxHash.toString(),
	// 		executeSuccess[executeSuccess.length - 1]['txHash'].toString(),
	// 		"The event execute success should exist."
	// 	);

	// 	let paymentActual = toBN(executeSuccess[executeSuccess.length - 1]['payment'])
	//     await TokenHelper.isEqualBalance(daicpxdToken, relayer, paymentActual.toString());

	// 	let prepaidCard = await getGnosisSafeFromEventLog(safeTx);

	// 	assert.equal(prepaidCard.length, 1, "Should create a new card(gnosis safe).");
	// 	assert.isTrue(await prepaidCard[0].isOwner(walletOfSupplier.address))
		
 //        await TokenHelper.isEqualBalance(daicpxdToken, prepaidCard[0].address, TokenHelper.amountOf(1));

	// 	await TokenHelper.isEqualBalance(daicpxdToken, walletOfSupplier.address, toBN(TokenHelper.amountOf(19)).sub(paymentActual));

	// });

	// it("Supplier create multi Prepaid Card (1 daicpxd 2 daicpxd 5 daicpxd) ", async () => {
	// 	let oldWalletBalance = await daicpxdToken.balanceOf(walletOfSupplier.address);
	// 	let oldRelayerBalance = await daicpxdToken.balanceOf(relayer)
	// 	let amounts = [1, 2, 5].map(amount => TokenHelper.amountOf(amount));

	// 	let payloads = daicpxdToken.contract.methods
	// 		.transferAndCall(
	// 			prepaidCardManager.address,
	// 			TokenHelper.amountOf(8),
	// 			ContractHelper.prepareDataForCreateMutipleToken(
	// 				walletOfSupplier.address,
	// 				amounts
	// 			)
	// 		)
	// 		.encodeABI();

	// 	let safeTxData = {
	// 		to: daicpxdToken.address,
	// 		value: 0,
	// 		data: payloads,
	// 		operation: 0,
	// 		txGasEstimate: 1000000,
	// 		baseGasEstimate: 0,
	// 		gasPrice: 1000000000,
	// 		txGasToken: daicpxdToken.address,
	// 		refundReceive: relayer
	// 	}

	// 	let {
	// 		safeTxHash,
	// 		safeTx
	// 	} = await ContractHelper.signAndSendSafeTransactionByRelayer(
	// 		safeTxData,
	// 		supplier,
	// 		walletOfSupplier,
	// 		relayer
	// 	)

	// 	prepaidCards = await getGnosisSafeFromEventLog(safeTx);

	// 	let executeSuccess = getParamsFromEvent(safeTx, EXECUTE_EVENT_SUCCESS, EXECUTE_EVENT_META);
	// 	assert.equal(
	// 		safeTxHash.toString(),
	// 		executeSuccess[executeSuccess.length - 1]['txHash'].toString(),
	// 		"The event execute success should exist."
	// 	);

	// 	assert.equal(prepaidCards.length, 3, "Should create a new 3 cards(gnosis safe).");

	// 	prepaidCards.forEach(async function (prepaidCard, index) {
	// 		assert.isTrue(await prepaidCard.isOwner(walletOfSupplier.address))
	// 		assert.isTrue(await prepaidCard.isOwner(prepaidCardManager.address))
	// 		TokenHelper.isEqualBalance(daicpxdToken, prepaidCard.address, amounts[index]);
	// 	})

	// 	let payment = toBN(executeSuccess[executeSuccess.length - 1]['payment']);
	// 	await TokenHelper.isEqualBalance(
	// 		daicpxdToken, 
	// 		walletOfSupplier.address,
	// 		oldWalletBalance.sub(payment).sub(toBN(TokenHelper.amountOf(8)))
	// 	);

	// 	await TokenHelper.isEqualBalance(daicpxdToken, relayer, oldRelayerBalance.add(payment));
	// });

	// it("Supplier Create multi Prepaid Card fail when amount > supplier's balance", async () => {

	// 	let oldWalletBalance = await daicpxdToken.balanceOf(walletOfSupplier.address);
	// 	let oldRelayerBalance = await daicpxdToken.balanceOf(relayer)
	// 	let amounts = [10, 20, 80].map(amount => TokenHelper.amountOf(amount));

	// 	let payloads = daicpxdToken.contract.methods
	// 		.transferAndCall(
	// 			prepaidCardManager.address,
	// 			TokenHelper.amountOf(80),
	// 			ContractHelper.prepareDataForCreateMutipleToken(
	// 				walletOfSupplier.address,
	// 				amounts
	// 			)
	// 		)
	// 		.encodeABI();

	// 	let safeTxData = {
	// 		to: daicpxdToken.address,
	// 		value: 0,
	// 		data: payloads,
	// 		operation: 0,
	// 		txGasEstimate: 1000000,
	// 		baseGasEstimate: 0,
	// 		gasPrice: 1000000000,
	// 		txGasToken: daicpxdToken.address,
	// 		refundReceive: relayer
	// 	}

	// 	let {
	// 		safeTxHash,
	// 		safeTx
	// 	} = await ContractHelper.signAndSendSafeTransactionByRelayer(
	// 		safeTxData,
	// 		supplier,
	// 		walletOfSupplier,
	// 		relayer
	// 	)


	// 	let executeFailed = getParamsFromEvent(safeTx, EXECUTE_EVENT_FAILED, EXECUTE_EVENT_META);
	// 	assert.equal(safeTxHash.toString(), executeFailed[0]['txHash'].toString());
		
	// 	let successPrepaidCards = await getGnosisSafeFromEventLog(safeTx);
	// 	assert.equal(successPrepaidCards.length, 0);

	// 	let payment = toBN(executeFailed[0]['payment']);
	// 	await TokenHelper.isEqualBalance(daicpxdToken, walletOfSupplier.address, oldWalletBalance.sub(payment));
	// 	await TokenHelper.isEqualBalance(daicpxdToken, relayer, oldRelayerBalance.add(payment));
	// });

	// it('supplier create number card is zero', async () => {
	// 	let amountBefore = await daicpxdToken.balanceOf(walletOfSupplier.address);

	// 	let payloads = daicpxdToken.contract.methods
	// 		.transferAndCall(
	// 			prepaidCardManager.address,
	// 			TokenHelper.amountOf(7),
	// 			ContractHelper.prepareDataForCreateMutipleToken(walletOfSupplier.address, [])
	// 		).encodeABI();

	// 	let safeTxData = {
	// 		to: daicpxdToken.address,
	// 		value: 0,
	// 		data: payloads,
	// 		operation: 0,
	// 		txGasEstimate: 1000000,
	// 		baseGasEstimate: 0,
	// 		gasPrice: 1000000000,
	// 		txGasToken: daicpxdToken.address,
	// 		refundReceive: relayer
	// 	}

	// 	let {
	// 		safeTxHash,
	// 		safeTx
	// 	} = await ContractHelper.signAndSendSafeTransactionByRelayer(
	// 		safeTxData,
	// 		supplier,
	// 		walletOfSupplier,
	// 		relayer
	// 	)


	// 	let executeFailed = getParamsFromEvent(safeTx, EXECUTE_EVENT_FAILED, EXECUTE_EVENT_META);
	// 	assert.ok(Array.isArray(executeFailed) && executeFailed.length > 0)
	// 	assert.deepEqual(safeTxHash.toString(), executeFailed[0]['txHash']);
		
	// 	let payment = toBN(executeFailed[0]['payment']);

	// 	await TokenHelper.isEqualBalance(daicpxdToken, walletOfSupplier.address, amountBefore.sub(payment));
	// })

	// it("Supplier create multi Prepaid Card fail with not allow payable token (1 daicpxd 2 daicpxd 5 daicpxd) ", async () => {
	// 	let oldWalletBalance = await daicpxdToken.balanceOf(walletOfSupplier.address);
	// 	let oldRelayerBalance = await daicpxdToken.balanceOf(relayer)

	// 	let amounts = [1, 2, 5].map(amount => TokenHelper.amountOf(amount));

	// 	let payloads = fakeDaicpxdToken.contract.methods
	// 		.transferAndCall(
	// 			prepaidCardManager.address,
	// 			TokenHelper.amountOf(8),
	// 			ContractHelper.prepareDataForCreateMutipleToken(
	// 				walletOfSupplier.address,
	// 				amounts
	// 			)
	// 		)
	// 		.encodeABI();

	// 	let safeTxData = {
	// 		to: fakeDaicpxdToken.address,
	// 		value: 0,
	// 		data: payloads,
	// 		operation: 0,
	// 		txGasEstimate: 1000000,
	// 		baseGasEstimate: 0,
	// 		gasPrice: 10000000000,
	// 		txGasToken: daicpxdToken.address,
	// 		refundReceive: relayer
	// 	}

	// 	let {
	// 		safeTxHash,
	// 		safeTx
	// 	} = await ContractHelper.signAndSendSafeTransactionByRelayer(
	// 		safeTxData,
	// 		supplier,
	// 		walletOfSupplier,
	// 		relayer
	// 	)

	// 	let executeFailed = getParamsFromEvent(safeTx, EXECUTE_EVENT_FAILED, EXECUTE_EVENT_META);
	// 	assert.equal(safeTxHash.toString(), executeFailed[0]['txHash'].toString());

	// 	// let successPrepaidCards = await getGnosisSafeFromEventLog(safeTx);
	// 	// assert.equal(successPrepaidCards.length, 0);
		
	// 	let payment = toBN(executeFailed[0]['payment']);
	// 	await TokenHelper.isEqualBalance(daicpxdToken, walletOfSupplier.address, oldWalletBalance.sub(payment));
	// 	await TokenHelper.isEqualBalance(daicpxdToken, relayer, oldRelayerBalance.add(payment));
	// });

	// it("Supplier sell card with 5 daicpxd (prepaidCards[2]) to customer", async () => {
	// 	let txs = [{
	// 			to: prepaidCards[2].address,
	// 			value: 0,
	// 			data: prepaidCards[2].contract.methods
	// 				.approveHash(
	// 					await prepaidCardManager.getSellCardHash(
	// 						prepaidCards[2].address,
	// 						walletOfSupplier.address,
	// 						customer,
	// 						(await prepaidCards[2].nonce.call()).toNumber()
	// 					)
	// 				)
	// 				.encodeABI(),
	// 		},
	// 		{
	// 			to: prepaidCardManager.address,
	// 			value: 0,
	// 			data: prepaidCardManager.contract.methods
	// 				.sellCard(
	// 					prepaidCards[2].address,
	// 					walletOfSupplier.address,
	// 					customer,
	// 					await prepaidCardManager.appendPrepaidCardAdminSignature(
	// 						walletOfSupplier.address,
	// 						`0x000000000000000000000000${walletOfSupplier.address.replace(
	// 							"0x",
	// 							""
	// 						)}000000000000000000000000000000000000000000000000000000000000000001`
	// 					)
	// 				)
	// 				.encodeABI(),
	// 		},
	// 	];

	// 	let payloads = encodeMultiSendCall(txs, multiSend);

	// 	let safeTxData = {
	// 		to: multiSend.address,
	// 		value: 0,
	// 		data: payloads,
	// 		operation: 1,
	// 		txGasEstimate: 0,
	// 		baseGasEstimate: 0,
	// 		gasPrice: 0,
	// 		txGasToken: ZERO_ADDRESS,
	// 		refundReceive: relayer
	// 	}

	// 	let {
	// 		safeTxHash,
	// 		safeTx
	// 	} = await ContractHelper.signAndSendSafeTransactionByRelayer(
	// 		safeTxData,
	// 		supplier,
	// 		walletOfSupplier,
	// 		relayer
	// 	)

	// 	let executeSuccess = getParamsFromEvent(safeTx, EXECUTE_EVENT_SUCCESS, EXECUTE_EVENT_META);
	// 	assert.equal(safeTxHash.toString(), executeSuccess[executeSuccess.length - 1]['txHash'].toString());
	// 	assert.isTrue(await prepaidCards[2].isOwner(customer));
	// 	await TokenHelper.isEqualBalance(daicpxdToken, prepaidCards[2].address, TokenHelper.amountOf(5));
	// });

	// it("Customer can not sell card with 5 daicpxd (prepaidCards[2]) to another customer", async () => {
	// 	let otherCustomer = merchant1;

	// 	let payloads;

	// 	let canGetSellCardData = true;
        
	// 	try {
	// 		payloads = await prepaidCardManager.getSellCardData(
	// 			prepaidCards[2].address,
	// 			customer,
	// 			otherCustomer
	// 		);
	// 	} catch (err) {
	// 		canGetSellCardData = false;
	// 	}

	// 	assert(canGetSellCardData === false, "Can not getSellCardData");

	// 	payloads = prepaidCards[2].contract.methods.swapOwner(
	// 		prepaidCardManager.address,
	// 		customer,
	// 		otherCustomer
	// 	);

	// 	const signature = await signSafeTransaction(
	// 		prepaidCardManager.address,
	// 		0,
	// 		payloads.toString(),
	// 		0,
	// 		0,
	// 		0,
	// 		0,
	// 		ZERO_ADDRESS,
	// 		ZERO_ADDRESS,
	// 		await prepaidCards[2].nonce(),
	// 		customer,
	// 		prepaidCards[2]
	// 	);

	// 	try {
	// 		await prepaidCardManager.sellCard(
	// 			prepaidCards[2].address,
	// 			customer,
	// 			otherCustomer,
	// 			await prepaidCardManager.appendPrepaidCardAdminSignature(
	// 				customer,
	// 				signature
	// 			), {
	// 				from: relayer
	// 			}
	// 		);
	// 	} catch (err) {
 //            assert.equal(err.reason, "The card has been sold before")
	// 	}
	// });

});