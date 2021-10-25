const ERC677Token = artifacts.require("ERC677Token.sol");
const PrepaidCardManager = artifacts.require("PrepaidCardManager");
const PrepaidCardMarket = artifacts.require("PrepaidCardMarket");
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory");
const GnosisSafe = artifacts.require("GnosisSafe");
const ActionDispatcher = artifacts.require("ActionDispatcher");
const TokenManager = artifacts.require("TokenManager");
const SupplierManager = artifacts.require("SupplierManager");

const utils = require("./utils/general");
const eventABIs = require("./utils/constant/eventABIs");

const { ZERO_ADDRESS, getParamsFromEvent } = utils;
const { expect, TOKEN_DETAIL_DATA } = require("./setup");

const {
  toTokenUnit,
  setupExchanges,
  createPrepaidCards,
  addActionHandlers,
  createDepotFromSupplierMgr,
  setPrepaidCardInventory,
  transferOwner,
  removePrepaidCardInventory,
  setPrepaidCardAsk,
  splitPrepaidCard,
  setupVersionManager,
} = require("./utils/helper");
const AbiCoder = require("web3-eth-abi");

contract("PrepaidCardMarket", (accounts) => {
  let daicpxdToken,
    issuer,
    owner,
    relayer,
    actionDispatcher,
    customer,
    provisioner,
    proxyFactory,
    gnosisSafeMasterCopy,
    prepaidCardManager,
    prepaidCardMarket,
    versionManager,
    setPrepaidCardInventoryHandler,
    removePrepaidCardInventoryHandler,
    setPrepaidCardAskHandler,
    fundingCard,
    depot;

  async function makePrepaidCards(amounts, marketAddress = ZERO_ADDRESS) {
    let { prepaidCards } = await createPrepaidCards(
      depot,
      prepaidCardManager,
      daicpxdToken,
      issuer,
      relayer,
      amounts,
      null,
      "did:cardstack:test",
      marketAddress
    );
    return prepaidCards;
  }

  before(async () => {
    owner = accounts[0];
    issuer = accounts[1];
    customer = accounts[2];
    relayer = accounts[3];
    provisioner = accounts[4];

    proxyFactory = await ProxyFactory.new();
    gnosisSafeMasterCopy = await utils.deployContract(
      "deploying Gnosis Safe Mastercopy",
      GnosisSafe
    );

    versionManager = await setupVersionManager(owner);
    prepaidCardManager = await PrepaidCardManager.new();
    await prepaidCardManager.initialize(owner);
    prepaidCardMarket = await PrepaidCardMarket.new();
    await prepaidCardMarket.initialize(owner);
    let supplierManager = await SupplierManager.new();
    await supplierManager.initialize(owner);
    actionDispatcher = await ActionDispatcher.new();
    await actionDispatcher.initialize(owner);
    let tokenManager = await TokenManager.new();
    await tokenManager.initialize(owner);

    let exchange, cardcpxdToken;
    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));

    await daicpxdToken.mint(owner, toTokenUnit(100));

    await tokenManager.setup(
      ZERO_ADDRESS,
      [daicpxdToken.address, cardcpxdToken.address],
      versionManager.address
    );

    await supplierManager.setup(
      ZERO_ADDRESS,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      versionManager.address
    );
    await prepaidCardManager.setup(
      tokenManager.address,
      supplierManager.address,
      exchange.address,
      gnosisSafeMasterCopy.address,
      proxyFactory.address,
      actionDispatcher.address,
      ZERO_ADDRESS,
      0,
      100,
      500000,
      [prepaidCardMarket.address],
      versionManager.address
    );
    await prepaidCardManager.addGasPolicy("transfer", false);
    await prepaidCardManager.addGasPolicy("split", true);
    await prepaidCardManager.addGasPolicy("setPrepaidCardInventory", true);
    await prepaidCardManager.addGasPolicy("removePrepaidCardInventory", true);
    await prepaidCardManager.addGasPolicy("setPrepaidCardAsk", true);

    await prepaidCardMarket.setup(
      prepaidCardManager.address,
      actionDispatcher.address,
      provisioner,
      versionManager.address
    );

    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address,
      versionManager.address
    );

    ({
      setPrepaidCardInventoryHandler,
      removePrepaidCardInventoryHandler,
      setPrepaidCardAskHandler,
    } = await addActionHandlers({
      prepaidCardManager,
      prepaidCardMarket,
      actionDispatcher,
      tokenManager,
      owner,
      versionManager,
    }));

    depot = await createDepotFromSupplierMgr(supplierManager, issuer);
    await daicpxdToken.mint(depot.address, toTokenUnit(1000));

    [fundingCard] = await makePrepaidCards([toTokenUnit(10)]);
    await cardcpxdToken.mint(fundingCard.address, toTokenUnit(1));
  });

  beforeEach(async () => {
    await prepaidCardMarket.setPaused(false);
  });

  describe("manage inventory", () => {
    describe("setItems", () => {
      it(`can set item in the inventory`, async function () {
        let [testCard] = await makePrepaidCards([toTokenUnit(10)]);
        let sku = await prepaidCardMarket.skuForPrepaidCard(testCard.address)
          .should.be.fulfilled;
        let startingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingCard.address
        );
        expect(await prepaidCardMarket.getInventory(sku)).to.deep.equal([]);

        let safeTx = await setPrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCard,
          prepaidCardMarket,
          issuer,
          relayer
        );

        let [safeEvent] = getParamsFromEvent(
          safeTx,
          eventABIs.EXECUTION_SUCCESS,
          fundingCard.address
        );
        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.SET_PREPAID_CARD_INVENTORY,
          prepaidCardMarket.address
        );
        expect(event.issuer).to.equal(issuer);
        expect(event.issuingToken).to.equal(daicpxdToken.address);
        expect(event.prepaidCard).to.equal(testCard.address);
        expect(event.sku).to.equal(sku);
        expect(event.faceValue).to.equal("1000");
        expect(event.customizationDID).to.equal("did:cardstack:test");

        expect(
          await prepaidCardManager.getPrepaidCardOwner(testCard.address)
        ).to.equal(prepaidCardMarket.address);
        expect(await prepaidCardMarket.getInventory(sku)).to.deep.equal([
          testCard.address,
        ]);
        expect(await prepaidCardMarket.getQuantity(sku)).to.equal(1);

        let skuInfo = await prepaidCardMarket.skus(sku);
        expect(skuInfo.issuer).to.equal(issuer);
        expect(skuInfo.issuingToken).to.equal(daicpxdToken.address);
        expect(skuInfo.faceValue.toString()).to.equal("1000");
        expect(skuInfo.customizationDID).to.equal("did:cardstack:test");

        let endingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingCard.address
        );
        expect(parseInt(safeEvent.payment)).to.be.greaterThan(0);
        expect(
          startingFundingCardBalance.sub(endingFundingCardBalance).toString()
        ).to.equal(safeEvent.payment, "prepaid card paid actual cost of gas");
      });

      it(`can set an item in inventory via splitting a prepaid card`, async function () {
        let safeTx = await splitPrepaidCard(
          prepaidCardManager,
          fundingCard,
          relayer,
          issuer,
          200,
          [toTokenUnit(2)],
          "did:cardstack:split-inventory-test",
          prepaidCardMarket.address
        );
        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.SET_PREPAID_CARD_INVENTORY,
          prepaidCardMarket.address
        );
        let { sku } = event;
        let testCard = await GnosisSafe.at(event.prepaidCard);
        expect(event.issuer).to.equal(issuer);
        expect(event.issuingToken).to.equal(daicpxdToken.address);
        expect(event.faceValue).to.equal("200");
        expect(event.customizationDID).to.equal(
          "did:cardstack:split-inventory-test"
        );

        let inventory = await prepaidCardMarket.getInventory(sku);
        expect(inventory.length).to.equal(1);
        expect(
          await prepaidCardManager.getPrepaidCardOwner(testCard.address)
        ).to.equal(prepaidCardMarket.address);
        expect(inventory).to.deep.equal([testCard.address]);

        let skuInfo = await prepaidCardMarket.skus(sku);
        expect(skuInfo.issuer).to.equal(issuer);
        expect(skuInfo.issuingToken).to.equal(daicpxdToken.address);
        expect(skuInfo.faceValue.toString()).to.equal("200");
        expect(skuInfo.customizationDID).to.equal(
          "did:cardstack:split-inventory-test"
        );
      });

      it(`rejects when the issuer is not an owner of the prepaid card`, async function () {
        let [testCard] = await makePrepaidCards([toTokenUnit(10)]);
        await transferOwner(
          prepaidCardManager,
          testCard,
          issuer,
          customer,
          relayer
        );
        expect(
          await prepaidCardManager.getPrepaidCardOwner(testCard.address)
        ).to.equal(customer);

        await setPrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCard,
          prepaidCardMarket,
          issuer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });

      it(`rejects when the sender of the prepaid card action is not the issuer of the prepaid card being added to inventory`, async function () {
        let [testCard] = await makePrepaidCards([toTokenUnit(10)]);
        await setPrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCard,
          prepaidCardMarket,
          customer,
          relayer
        ).should.be.rejectedWith(Error, "Invalid owner provided");
      });

      it(`rejects when the market address is missing`, async function () {
        let [testCard] = await makePrepaidCards([toTokenUnit(10)]);
        await setPrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCard,
          ZERO_ADDRESS,
          issuer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });

      it(`rejects when the prepaid card is used`, async function () {
        let [testCard] = await makePrepaidCards([toTokenUnit(10)]);
        // splitting a card is a form of using it
        await splitPrepaidCard(
          prepaidCardManager,
          testCard,
          relayer,
          issuer,
          100,
          [toTokenUnit(1).toString()],
          ""
        );
        await setPrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCard,
          prepaidCardMarket,
          issuer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });

      it(`rejects when prepaid card has already been added to inventory`, async function () {
        let [testCard] = await makePrepaidCards([toTokenUnit(10)]);
        await setPrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCard,
          prepaidCardMarket,
          issuer,
          relayer
        );

        await setPrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCard,
          prepaidCardMarket,
          issuer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });

      it(`rejects when non-handler sets items`, async function () {
        let [testCard] = await makePrepaidCards([toTokenUnit(10)]);
        await prepaidCardMarket
          .setItem(issuer, testCard.address)
          .should.be.rejectedWith(
            Error,
            "caller is not a registered action handler or PrepaidCardManager"
          );
      });
    });

    describe("removeItems", () => {
      let prepaidCards,
        sku,
        askPrice = toTokenUnit(10);

      before(async () => {
        prepaidCards = await makePrepaidCards(
          // TODO tune this to only the amount of cards we actually need
          [askPrice, askPrice, askPrice, askPrice],
          prepaidCardMarket.address
        );

        sku = await prepaidCardMarket.skuForPrepaidCard(
          prepaidCards[0].address
        );
        await setPrepaidCardAsk(
          prepaidCardManager,
          fundingCard,
          askPrice,
          sku,
          prepaidCardMarket,
          issuer,
          relayer
        );
        for (let prepaidCard of prepaidCards) {
          expect(
            await prepaidCardManager.getPrepaidCardOwner(prepaidCard.address)
          ).to.equal(prepaidCardMarket.address);
        }
      });

      it(`can remove items from the inventory`, async function () {
        let inventory = await prepaidCardMarket.getInventory(sku);
        let startingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingCard.address
        );
        expect(inventory.length).to.be.greaterThanOrEqual(2);
        let testCards = await Promise.all(
          inventory.slice(0, 2).map((a) => GnosisSafe.at(a))
        );
        let startingInventory = await prepaidCardMarket.getInventory(sku);
        expect(startingInventory.includes(testCards[0].address)).to.equal(
          true,
          "card exists in inventory"
        );
        expect(startingInventory.includes(testCards[1].address)).to.equal(
          true,
          "card exists in inventory"
        );

        let safeTx = await removePrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCards,
          prepaidCardMarket,
          issuer,
          relayer
        );
        let events = getParamsFromEvent(
          safeTx,
          eventABIs.REMOVE_PREPAID_CARD_INVENTORY,
          prepaidCardMarket.address
        );
        let [safeEvent] = getParamsFromEvent(
          safeTx,
          eventABIs.EXECUTION_SUCCESS,
          fundingCard.address
        );
        expect(events.length).to.equal(2);
        for (let event of events) {
          expect(
            testCards.map((p) => p.address).includes(event.prepaidCard)
          ).to.equal(true, "the event prepaidCard address is correct");
          expect(event.issuer).to.equal(issuer);
          expect(event.sku).to.equal(sku);
        }

        inventory = await prepaidCardMarket.getInventory(sku);
        expect(inventory.length).to.equal(startingInventory.length - 2);

        for (let testCard of testCards) {
          expect(inventory.includes(testCard.address)).to.equal(
            false,
            "card does not exist in inventory"
          );
          expect(
            await prepaidCardManager.getPrepaidCardOwner(testCard.address)
          ).to.equal(issuer);
        }

        let endingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingCard.address
        );
        expect(parseInt(safeEvent.payment)).to.be.greaterThan(0);
        expect(
          startingFundingCardBalance.sub(endingFundingCardBalance).toString()
        ).to.equal(safeEvent.payment, "prepaid card paid actual cost of gas");
      });

      it(`rejects when there are no prepaid cards specified`, async function () {
        await removePrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          [],
          prepaidCardMarket,
          issuer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });

      it(`rejects when the sender of the prepaid card action is not the issuer of the prepaid cards`, async function () {
        let inventory = await prepaidCardMarket.getInventory(sku);
        expect(inventory.length).to.be.greaterThanOrEqual(1);
        let testCards = await Promise.all(
          inventory.slice(0, 1).map((a) => GnosisSafe.at(a))
        );
        await removePrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCards,
          prepaidCardMarket,
          customer,
          relayer
        ).should.be.rejectedWith(Error, "Invalid owner provided");
      });

      it(`rejects when contract is paused (paused contract cannot perform EIP-1271 signing)`, async function () {
        let inventory = await prepaidCardMarket.getInventory(sku);
        expect(inventory.length).to.be.greaterThanOrEqual(1);
        let testCards = await Promise.all(
          inventory.slice(0, 1).map((a) => GnosisSafe.at(a))
        );
        await prepaidCardMarket.setPaused(true);
        await removePrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCards,
          prepaidCardMarket,
          issuer,
          relayer
        ).should.be.rejectedWith(Error, "safe transaction was reverted");
      });

      it(`rejects when market address is missing`, async function () {
        let inventory = await prepaidCardMarket.getInventory(sku);
        expect(inventory.length).to.be.greaterThanOrEqual(1);
        let testCards = await Promise.all(
          inventory.slice(0, 1).map((a) => GnosisSafe.at(a))
        );
        await removePrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCards,
          ZERO_ADDRESS,
          issuer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });

      it(`rejects when prepaid card has already been provisioned`, async function () {
        let tx = await prepaidCardMarket.provisionPrepaidCard(customer, sku, {
          from: provisioner,
        });
        let [event] = getParamsFromEvent(
          tx,
          eventABIs.PROVISION_PREPAID_CARD,
          prepaidCardMarket.address
        );
        expect(
          await prepaidCardManager.getPrepaidCardOwner(event.prepaidCard)
        ).to.equal(customer);
        let testCards = [await GnosisSafe.at(event.prepaidCard)];

        await removePrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCards,
          prepaidCardMarket,
          issuer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });

      it(`rejects when non-handler removes items`, async function () {
        let inventory = await prepaidCardMarket.getInventory(sku);
        expect(inventory.length).to.be.greaterThanOrEqual(1);
        let testCardAddresses = inventory.slice(0, 1);
        await prepaidCardMarket
          .removeItems(issuer, testCardAddresses)
          .should.be.rejectedWith(
            Error,
            "caller is not a registered action handler"
          );
      });
    });

    describe("setAsk", () => {
      let prepaidCard,
        sku,
        askPrice = toTokenUnit(5);

      before(async () => {
        ({
          prepaidCards: [prepaidCard],
        } = await createPrepaidCards(
          depot,
          prepaidCardManager,
          daicpxdToken,
          issuer,
          relayer,
          [askPrice],
          null,
          "did:cardstack:test",
          prepaidCardMarket.address
        ));
        sku = await prepaidCardMarket.skuForPrepaidCard(prepaidCard.address);
      });

      it(`can set the asking price for a sku`, async function () {
        let startingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingCard.address
        );
        let safeTx = await setPrepaidCardAsk(
          prepaidCardManager,
          fundingCard,
          askPrice,
          sku,
          prepaidCardMarket,
          issuer,
          relayer
        );
        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.SET_PREPAID_CARD_ASK,
          prepaidCardMarket.address
        );
        let [safeEvent] = getParamsFromEvent(
          safeTx,
          eventABIs.EXECUTION_SUCCESS,
          fundingCard.address
        );
        expect(event.issuer).to.equal(issuer);
        expect(event.issuingToken).to.equal(daicpxdToken.address);
        expect(event.sku).to.equal(sku);
        expect(event.askPrice).to.equal(askPrice.toString());

        expect((await prepaidCardMarket.asks(sku)).toString()).to.equal(
          askPrice.toString()
        );

        let endingFundingCardBalance = await daicpxdToken.balanceOf(
          fundingCard.address
        );
        expect(parseInt(safeEvent.payment)).to.be.greaterThan(0);
        expect(
          startingFundingCardBalance.sub(endingFundingCardBalance).toString()
        ).to.equal(safeEvent.payment, "prepaid card paid actual cost of gas");
      });

      it(`rejects when the sku does not exist`, async function () {
        await setPrepaidCardAsk(
          prepaidCardManager,
          fundingCard,
          askPrice,
          "0xdeadbeefe23942d80a4259cdea3614ce660c20ad7d1b61d9a70598ed26ddbf09",
          prepaidCardMarket,
          issuer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });

      it(`rejects when the sku is not owned by issuer`, async function () {
        // create a funding card that a non-issuer owns
        let [customerCard] = await makePrepaidCards([toTokenUnit(10)]);
        await transferOwner(
          prepaidCardManager,
          customerCard,
          issuer,
          customer,
          relayer
        );

        await setPrepaidCardAsk(
          prepaidCardManager,
          customerCard,
          askPrice,
          sku,
          prepaidCardMarket,
          customer,
          relayer
        ).should.be.rejectedWith(
          Error,
          // the real revert reason is behind the gnosis safe execTransaction
          // boundary, so we just get this generic error
          "safe transaction was reverted"
        );
      });

      it(`rejects when non-handler sets ask`, async function () {
        await prepaidCardMarket
          .setAsk(issuer, sku, toTokenUnit(10))
          .should.be.rejectedWith(
            Error,
            "caller is not a registered action handler"
          );
      });
    });
  });

  describe("provision prepaid cards", () => {
    let prepaidCards,
      sku,
      askPrice = toTokenUnit(10);

    before(async () => {
      ({ prepaidCards } = await createPrepaidCards(
        depot,
        prepaidCardManager,
        daicpxdToken,
        issuer,
        relayer,
        [askPrice, askPrice, askPrice],
        null,
        "did:cardstack:test",
        prepaidCardMarket.address
      ));
      sku = await prepaidCardMarket.skuForPrepaidCard(prepaidCards[0].address);
      await setPrepaidCardAsk(
        prepaidCardManager,
        fundingCard,
        askPrice,
        sku,
        prepaidCardMarket,
        issuer,
        relayer
      );

      for (let prepaidCard of prepaidCards) {
        expect(
          await prepaidCardManager.getPrepaidCardOwner(prepaidCard.address)
        ).to.equal(prepaidCardMarket.address);
        expect(
          await prepaidCardMarket.provisionedCards(prepaidCard.address)
        ).to.equal(ZERO_ADDRESS);
      }
    });

    it(`can allow the provisioner to provision a prepaid card from the inventory`, async function () {
      let startingInventory = await prepaidCardMarket.getInventory(sku);
      expect(startingInventory.length).to.be.greaterThanOrEqual(1);
      let startingBalance = await daicpxdToken.balanceOf(startingInventory[0]);
      let tx = await prepaidCardMarket.provisionPrepaidCard(customer, sku, {
        from: provisioner,
      });

      let [event] = getParamsFromEvent(
        tx,
        eventABIs.PROVISION_PREPAID_CARD,
        prepaidCardMarket.address
      );
      expect(startingInventory.includes(event.prepaidCard)).to.equal(
        true,
        "provisioned prepaid card was in the starting inventory"
      );
      expect(event.askPrice).to.equal(askPrice.toString());
      expect(event.customer).to.equal(customer);
      expect(event.sku).to.equal(sku);

      expect(
        await prepaidCardManager.getPrepaidCardOwner(event.prepaidCard)
      ).to.equal(customer);
      let inventory = await prepaidCardMarket.getInventory(sku);
      expect(inventory.length).to.equal(startingInventory.length - 1);
      expect(inventory.includes(event.prepaidCard)).to.equal(
        false,
        "provisioned prepaid card no longer in inventory"
      );
      expect(
        await prepaidCardMarket.provisionedCards(event.prepaidCard)
      ).to.equal(customer);
      expect(
        (await daicpxdToken.balanceOf(event.prepaidCard)).toString()
      ).to.equal(startingBalance.toString());
    });

    it(`can allow the owner to provision a prepaid card from the inventory`, async function () {
      let startingInventory = await prepaidCardMarket.getInventory(sku);
      expect(startingInventory.length).to.be.greaterThanOrEqual(1);
      let tx = await prepaidCardMarket.provisionPrepaidCard(customer, sku, {
        from: owner,
      });

      let [event] = getParamsFromEvent(
        tx,
        eventABIs.PROVISION_PREPAID_CARD,
        prepaidCardMarket.address
      );
      expect(startingInventory.includes(event.prepaidCard)).to.equal(
        true,
        "provisioned prepaid card was in the starting inventory"
      );
      expect(
        await prepaidCardManager.getPrepaidCardOwner(event.prepaidCard)
      ).to.equal(customer);
      let inventory = await prepaidCardMarket.getInventory(sku);
      expect(inventory.length).to.equal(startingInventory.length - 1);
      expect(inventory.includes(event.prepaidCard)).to.equal(
        false,
        "provisioned prepaid card no longer in inventory"
      );
    });

    it(`rejects when a non-provisioner/owner provisions a prepaid card from the inventory`, async function () {
      expect(
        (await prepaidCardMarket.getInventory(sku)).length
      ).to.be.greaterThanOrEqual(1);
      await prepaidCardMarket
        .provisionPrepaidCard(customer, sku, {
          from: customer,
        })
        .should.be.rejectedWith(
          Error,
          "caller is not the provisioner nor the owner"
        );
    });

    it(`rejects when the ask price for the sku is 0`, async function () {
      expect(
        (await prepaidCardMarket.getInventory(sku)).length
      ).to.be.greaterThanOrEqual(1);
      await setPrepaidCardAsk(
        prepaidCardManager,
        fundingCard,
        "0",
        sku,
        prepaidCardMarket,
        issuer,
        relayer
      );

      await prepaidCardMarket
        .provisionPrepaidCard(customer, sku)
        .should.be.rejectedWith(Error, "No ask price for sku");

      // reset ask price for subsequent tests
      await setPrepaidCardAsk(
        prepaidCardManager,
        fundingCard,
        askPrice,
        sku,
        prepaidCardMarket,
        issuer,
        relayer
      );
    });

    it(`rejects when contract is paused`, async function () {
      expect(
        (await prepaidCardMarket.getInventory(sku)).length
      ).to.be.greaterThanOrEqual(1);
      await prepaidCardMarket.setPaused(true);
      await prepaidCardMarket
        .provisionPrepaidCard(customer, sku, {
          from: provisioner,
        })
        .should.be.rejectedWith(Error, "Contract is paused");
    });

    it(`rejects when no more inventory exists for the sku`, async function () {
      let inventory = await prepaidCardMarket.getInventory(sku);
      for (let i = 0; i < inventory.length; i++) {
        await prepaidCardMarket.provisionPrepaidCard(customer, sku);
      }
      expect((await prepaidCardMarket.getInventory(sku)).length).to.equal(0);

      await prepaidCardMarket
        .provisionPrepaidCard(customer, sku)
        .should.be.rejectedWith(Error, "No more prepaid cards for sku");
    });
  });

  describe("contract management", () => {
    it("owner can pause contract", async function () {
      await prepaidCardMarket.setPaused(true);
      expect(await prepaidCardMarket.paused()).to.equal(true);
    });

    it("owner can resume contract", async function () {
      await prepaidCardMarket.setPaused(true);
      await prepaidCardMarket.setPaused(false);
      expect(await prepaidCardMarket.paused()).to.equal(false);
    });

    it("rejects when non-owner pauses contract", async function () {
      await prepaidCardMarket
        .setPaused(true, { from: customer })
        .should.be.rejectedWith(Error, "Ownable: caller is not the owner");
    });
  });

  describe("action handlers", () => {
    let fakeDaicpxdToken, testCards, sku;

    before(async () => {
      fakeDaicpxdToken = await ERC677Token.new();
      await fakeDaicpxdToken.initialize(...TOKEN_DETAIL_DATA, owner);
      await fakeDaicpxdToken.mint(owner, toTokenUnit(100));

      testCards = await makePrepaidCards(
        [toTokenUnit(10)],
        prepaidCardMarket.address
      );

      sku = await prepaidCardMarket.skuForPrepaidCard(testCards[0].address);
      await setPrepaidCardAsk(
        prepaidCardManager,
        fundingCard,
        toTokenUnit(10),
        sku,
        prepaidCardMarket,
        issuer,
        relayer
      );
    });

    it(`does not allow non-action dispatcher to call transferAndCall SetPrepaidCardInventoryHandler`, async function () {
      let [testCard] = await makePrepaidCards([toTokenUnit(10)]);
      await daicpxdToken
        .transferAndCall(
          setPrepaidCardInventoryHandler.address,
          "0",
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              fundingCard.address,
              "0",
              AbiCoder.encodeParameters(
                ["address", "address", "bytes"],
                [testCard.address, prepaidCardMarket.address, "0x0"]
              ),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it(`does not allow non-CPXD token to call SetPrepaidCardInventoryHandler`, async function () {
      let [testCard] = await makePrepaidCards([toTokenUnit(10)]);
      await fakeDaicpxdToken
        .transferAndCall(
          setPrepaidCardInventoryHandler.address,
          "0",
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              fundingCard.address,
              "0",
              AbiCoder.encodeParameters(
                ["address", "address", "bytes"],
                [testCard.address, prepaidCardMarket.address, "0x0"]
              ),
            ]
          )
        )
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });

    it(`does not allow non-action dispatcher to call transferAndCall RemovePrepaidCardInventoryHandler`, async function () {
      await daicpxdToken
        .transferAndCall(
          removePrepaidCardInventoryHandler.address,
          "0",
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              fundingCard.address,
              "0",
              AbiCoder.encodeParameters(
                ["address[]", "address"],
                [testCards.map((a) => a.address), prepaidCardMarket.address]
              ),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });

    it(`does not allow non-CPXD token to call RemovePrepaidCardInventoryHandler`, async function () {
      await fakeDaicpxdToken
        .transferAndCall(
          removePrepaidCardInventoryHandler.address,
          "0",
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              fundingCard.address,
              "0",
              AbiCoder.encodeParameters(
                ["address[]", "address"],
                [testCards.map((a) => a.address), prepaidCardMarket.address]
              ),
            ]
          )
        )
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });

    it(`does not allow non-action dispatcher to call transferAndCall SetPrepaidCardAskHandler`, async function () {
      await daicpxdToken
        .transferAndCall(
          setPrepaidCardAskHandler.address,
          "0",
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              fundingCard.address,
              "0",
              AbiCoder.encodeParameters(
                ["bytes32", "uint256", "address"],
                [sku, toTokenUnit(10).toString(), prepaidCardMarket.address]
              ),
            ]
          )
        )
        .should.be.rejectedWith(
          Error,
          "can only accept tokens from action dispatcher"
        );
    });
    it(`does not allow non-CPXD token to call SetPrepaidCardAskHandler`, async function () {
      await fakeDaicpxdToken
        .transferAndCall(
          setPrepaidCardAskHandler.address,
          "0",
          AbiCoder.encodeParameters(
            ["address", "uint256", "bytes"],
            [
              fundingCard.address,
              "0",
              AbiCoder.encodeParameters(
                ["bytes32", "uint256", "address"],
                [sku, toTokenUnit(10).toString(), prepaidCardMarket.address]
              ),
            ]
          )
        )
        .should.be.rejectedWith(Error, "calling token is unaccepted");
    });
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await prepaidCardMarket.cardpayVersion()).to.equal("1.0.0");
      expect(await setPrepaidCardInventoryHandler.cardpayVersion()).to.equal(
        "1.0.0"
      );
      expect(await removePrepaidCardInventoryHandler.cardpayVersion()).to.equal(
        "1.0.0"
      );
      expect(await setPrepaidCardAskHandler.cardpayVersion()).to.equal("1.0.0");
    });
  });
});
