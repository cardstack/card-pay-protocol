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
const { expect } = require("./setup");

const {
  toTokenUnit,
  setupExchanges,
  createPrepaidCards,
  addActionHandlers,
  createDepotFromSupplierMgr,
  setPrepaidCardInventory,
  removePrepaidCardInventory,
  setPrepaidCardAsk,
} = require("./utils/helper");

contract("PrepaidCardMarket", (accounts) => {
  let daicpxdToken,
    cardcpxdToken,
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
    setPrepaidCardInventoryHandler,
    removePrepaidCardInventoryHandler,
    setPrepaidCardAskHandler,
    fundingCard,
    depot;

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

    let exchange;
    ({ daicpxdToken, cardcpxdToken, exchange } = await setupExchanges(owner));

    await daicpxdToken.mint(owner, toTokenUnit(100));

    await tokenManager.setup(ZERO_ADDRESS, [
      daicpxdToken.address,
      cardcpxdToken.address,
    ]);

    await supplierManager.setup(
      ZERO_ADDRESS,
      gnosisSafeMasterCopy.address,
      proxyFactory.address
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
      cardcpxdToken.address,
      100,
      500000,
      [prepaidCardMarket.address]
    );
    await prepaidCardManager.addGasPolicy("transfer", false, true);
    await prepaidCardManager.addGasPolicy("split", true, true);

    // TODO this is a temporary gas policy until CS-1472 is done
    await prepaidCardManager.addGasPolicy(
      "setPrepaidCardInventory",
      true,
      true
    );
    await prepaidCardManager.addGasPolicy(
      "removePrepaidCardInventory",
      true,
      true
    );
    await prepaidCardManager.addGasPolicy("setPrepaidCardAsk", true, true);

    await prepaidCardMarket.setup(
      prepaidCardManager.address,
      actionDispatcher.address,
      provisioner
    );

    await actionDispatcher.setup(
      tokenManager.address,
      exchange.address,
      prepaidCardManager.address
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
    }));

    depot = await createDepotFromSupplierMgr(supplierManager, issuer);
    await daicpxdToken.mint(depot.address, toTokenUnit(1000));

    ({
      prepaidCards: [fundingCard],
    } = await createPrepaidCards(
      depot,
      prepaidCardManager,
      daicpxdToken,
      daicpxdToken,
      issuer,
      relayer,
      [toTokenUnit(10)]
    ));
    await cardcpxdToken.mint(fundingCard.address, toTokenUnit(1));
  });

  describe("manage inventory", () => {
    describe("setItems", () => {
      let prepaidCards;

      before(async () => {
        ({ prepaidCards } = await createPrepaidCards(
          depot,
          prepaidCardManager,
          daicpxdToken,
          daicpxdToken,
          issuer,
          relayer,
          // TODO tune this to only the amount of cards we actually need
          [toTokenUnit(10), toTokenUnit(10), toTokenUnit(10)],
          null,
          "did:cardstack:test"
        ));
        await cardcpxdToken.mint(fundingCard.address, toTokenUnit(1));
      });

      it(`can set item in the inventory`, async function () {
        let testCard = prepaidCards[0];
        let sku = await prepaidCardMarket.skuForPrepaidCard(testCard.address)
          .should.be.fulfilled;
        expect(await prepaidCardMarket.getInventory(sku)).to.deep.equal([]);

        let safeTx = await setPrepaidCardInventory(
          prepaidCardManager,
          fundingCard,
          testCard,
          prepaidCardMarket,
          daicpxdToken,
          cardcpxdToken,
          issuer,
          relayer
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

        let skuInfo = await prepaidCardMarket.skus(sku);
        expect(skuInfo.issuer).to.equal(issuer);
        expect(skuInfo.issuingToken).to.equal(daicpxdToken.address);
        expect(skuInfo.faceValue.toString()).to.equal("1000");
        expect(skuInfo.customizationDID).to.equal("did:cardstack:test");

        // TODO assert gas policy once CS-1472 is done
      });

      it(`rejects when the issuer is not an owner of the prepaid card`, async function () {});
      it(`rejects when the issuer is not the issuer of the prepaid card`, async function () {});
      it(`rejects when the market address is missing`, async function () {});
      it(`rejects when the prepaid card is used`, async function () {});
      it(`rejects when non-handler sets items`, async function () {});
    });

    describe("removeItems", () => {
      let prepaidCards,
        sku,
        askPrice = toTokenUnit(10);

      before(async () => {
        ({ prepaidCards } = await createPrepaidCards(
          depot,
          prepaidCardManager,
          daicpxdToken,
          daicpxdToken,
          issuer,
          relayer,
          // TODO tune this to only the amount of cards we actually need
          [askPrice, askPrice, askPrice, askPrice],
          null,
          "did:cardstack:test",
          prepaidCardMarket.address
        ));

        sku = await prepaidCardMarket.skuForPrepaidCard(
          prepaidCards[0].address
        );
        for (let prepaidCard of prepaidCards) {
          expect(
            await prepaidCardManager.getPrepaidCardOwner(prepaidCard.address)
          ).to.equal(prepaidCardMarket.address);
        }
      });

      it(`can remove items from the inventory`, async function () {
        let testCards = prepaidCards.slice(0, 2);
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
          daicpxdToken,
          issuer,
          relayer
        );
        let events = getParamsFromEvent(
          safeTx,
          eventABIs.REMOVE_PREPAID_CARD_INVENTORY,
          prepaidCardMarket.address
        );
        expect(events.length).to.equal(2);
        for (let event of events) {
          expect(
            testCards.map((p) => p.address).includes(event.prepaidCard)
          ).to.equal(true, "the event prepaidCard address is correct");
          expect(event.issuer).to.equal(issuer);
          expect(event.sku).to.equal(sku);
        }

        let inventory = await prepaidCardMarket.getInventory(sku);
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
      });

      it(`rejects when there are no prepaid cards specified`, async function () {});
      it(`rejects when there are too many prepaid cards specified`, async function () {});
      it(`rejects when the issuer is not the issuer of the prepaid cards`, async function () {});
      it(`rejects when market address is missing`, async function () {});
      it(`rejects when prepaid card has already been provisioned`, async function () {
        // invalid signature test
      });
      it(`rejects when non-handler removes items`, async function () {});
    });

    describe("setAsk", () => {
      let prepaidCard,
        sku,
        askPrice = toTokenUnit(10);

      before(async () => {
        ({
          prepaidCards: [prepaidCard],
        } = await createPrepaidCards(
          depot,
          prepaidCardManager,
          daicpxdToken,
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
        expect((await prepaidCardMarket.asks(sku)).toString()).to.equal("0");

        let safeTx = await setPrepaidCardAsk(
          prepaidCardManager,
          fundingCard,
          askPrice,
          sku,
          prepaidCardMarket,
          daicpxdToken,
          issuer,
          relayer
        );
        let [event] = getParamsFromEvent(
          safeTx,
          eventABIs.SET_PREPAID_CARD_ASK,
          prepaidCardMarket.address
        );
        expect(event.issuer).to.equal(issuer);
        expect(event.issuingToken).to.equal(daicpxdToken.address);
        expect(event.sku).to.equal(sku);
        expect(event.askPrice).to.equal(askPrice.toString());

        expect((await prepaidCardMarket.asks(sku)).toString()).to.equal(
          askPrice.toString()
        );
      });

      it(`it rejects when the sku does not exist`, async function () {});
      it(`it rejects when the sku is not owned by issuer`, async function () {});
      it(`it rejects when non-handler sets ask`, async function () {});
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
        daicpxdToken,
        issuer,
        relayer,
        // TODO tune this to only the amount of cards we actually need
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
        daicpxdToken,
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
    });

    it(`can allow the owner to provision a prepaid card from the inventory`, async function () {
      let startingInventory = await prepaidCardMarket.getInventory(sku);
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

    it(`rejects when a non-provisioner/owner provisions a prepaid card from the inventory`, async function () {});
    it(`rejects provisioning an already provisioned prepaid card`, async function () {
      // invalid signature test
    });
    it(`rejects when no more inventory exists for the sku`, async function () {});
    it(`rejects when the ask price for the sku is 0`, async function () {});
  });

  describe("action handlers", () => {
    it(`does not allow non-action dispatcher to call transferAndCall SetPrepaidCardInventoryHandler`, async function () {});
    it(`does not allow non-CPXD token to call SetPrepaidCardInventoryHandler`, async function () {});
  });

  describe("versioning", () => {
    it("can get version of contract", async () => {
      expect(await prepaidCardMarket.cardpayVersion()).to.match(/\d\.\d\.\d/);
      expect(await setPrepaidCardInventoryHandler.cardpayVersion()).to.match(
        /\d\.\d\.\d/
      );
      expect(await removePrepaidCardInventoryHandler.cardpayVersion()).to.match(
        /\d\.\d\.\d/
      );
      expect(await setPrepaidCardAskHandler.cardpayVersion()).to.match(
        /\d\.\d\.\d/
      );
    });
  });
});
