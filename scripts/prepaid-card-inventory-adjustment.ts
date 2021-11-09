import {
  makeFactory,
  patchNetworks,
  asyncMain,
  readAddressFile,
} from "./deploy/util";
import retry from "async-retry";
import hre from "hardhat";
import { ethers } from "hardhat";

patchNetworks();

const {
  network: { name: network },
} = hre;
const {
  BigNumber,
  utils: { formatUnits },
} = ethers;

const sku = process.env.SKU;

async function main() {
  if (!sku) {
    console.error("SKU env var is not set");
    process.exit(1);
  }
  console.log(`Adjusting prepaid cards in network ${network} for SKU ${sku}`);
  const market = await getContractInstance("PrepaidCardMarket");
  const ERC677 = await ethers.getContractFactory("ERC677Token");

  let prepaidCards = await market.getInventory(sku);
  let { faceValue, issuingToken } = await market.getSkuInfo(sku);
  let token = await ERC677.attach(issuingToken);
  let symbol = await token.symbol();
  let desiredTokenAmount = BigNumber.from(faceValue).mul(
    BigNumber.from(10).pow(16) // SPEND uses 10^2, hence 10^16
  );

  for (let prepaidCard of prepaidCards) {
    let balance = await token.balanceOf(prepaidCard);
    if (desiredTokenAmount.gt(balance)) {
      let topOffAmount = desiredTokenAmount.sub(balance);
      console.log(
        `Prepaid card ${prepaidCard}, has balance of ${formatUnits(
          balance
        )} ${symbol}. Top off amount is ${formatUnits(topOffAmount)} ${symbol}`
      );
      // await sendTx(async () => token.transfer(prepaidCard, topOffAmount));
    }
  }
}

async function getContractInstance(contractId: string) {
  const proxyAddresses = readAddressFile(network);
  const { contractName, proxy: address } = proxyAddresses[contractId];
  const contractFactory = await makeFactory(contractName);
  return await contractFactory.attach(address);
}

async function sendTx(cb) {
  return await retry(cb, { retries: 3 });
}

asyncMain(main);
