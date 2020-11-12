const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const RevenuePool = artifacts.require("RevenuePool.sol");
const DAICPXD = artifacts.require("DAICPXD.sol");
const SPEND = artifacts.require("SPEND.sol");
const CardModule = artifacts.require("CardModule.sol");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("gnosisSafe");
const CreateAndAddModules = artifacts.require("CreateAndAddModules");

const utils = require("./utils/general");

contract("Test Prepaid Card Manager contract", (accounts) => {
	let daicpxdToken,
		revenuePool,
		spendToken,
		cardModule,
		createAndAddModules,
		prepaidCardManager;
	let walletOfMerchant, lw;
	let tally, supplier, customer, merchant;

	before(async () => {
		lw = await utils.createLightwallet();
		tally = accounts[0];
		supplier = accounts[1];
		customer = accounts[2];
		merchant = accounts[3];

		let proxyFactory = await ProxyFactory.new();
		let gnosisSafeMasterCopy = await GnosisSafe.new();

		revenuePool = await RevenuePool.new();

		spendToken = await SPEND.new("SPEND Token", "SPEND", [
			revenuePool.address,
		]);

		// deploy and mint 10 daicpxd token for deployer as owner
		daicpxdToken = await DAICPXD.new("10000000000000000000");

		createAndAddModules = await CreateAndAddModules.new();
		prepaidCardManager = await PrepaidCardManager.new();
		cardModule = await CardModule.new();

		// setup for revenue pool
		await revenuePool.setup(
			tally,
			[gnosisSafeMasterCopy.address, proxyFactory.address],
			spendToken.address,
			[daicpxdToken.address]
		);

		await cardModule.setup(
			revenuePool.address,
			prepaidCardManager.address,
			tally
		);

		await prepaidCardManager.setup(
			tally,
			[
				gnosisSafeMasterCopy.address,
				proxyFactory.address,
				createAndAddModules.address,
				revenuePool.address,
				cardModule.address,
			],
			[daicpxdToken.address]
		);

		console.log("  Spend Token: " + spendToken.address);
		console.log("  Daicpxd Token: " + daicpxdToken.address);
		console.log("  Revenue Pool: " + revenuePool.address);
		console.log("  Card Module: " + cardModule.address);
		console.log("  Prepaid Card Manager: " + prepaidCardManager.address);
		console.log("\n");
	});
});
