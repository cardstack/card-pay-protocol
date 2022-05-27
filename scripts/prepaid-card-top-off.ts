import {
  makeFactory,
  patchNetworks,
  asyncMain,
  readAddressFile,
  getDeployAddress,
} from "./deploy/util";
import hre from "hardhat";
import { ethers } from "hardhat";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

patchNetworks();

const {
  network: { name: network },
} = hre;
const {
  BigNumber: BN,
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
  const ERC677 = await makeFactory("ERC677Token");

  let prepaidCards = await market.getInventory(sku);
  if (prepaidCards.length === 0) {
    console.log(`No prepaid card inventory for SKU ${sku}`);
    process.exit(0);
  }

  let { faceValue, issuingToken } = await market.getSkuInfo(sku);
  let token: Contract = ERC677.attach(issuingToken) as unknown as Contract;
  let symbol = await token.symbol();
  let balance = await token.balanceOf(await getDeployAddress());

  let desiredTokenAmount = BN.from(faceValue).mul(
    BN.from(10).pow(16) // SPEND uses 10^2, hence 10^16
  );
  console.log(
    `Current balance is ${formatUnits(
      balance
    )} ${symbol}. Desired prepaid card balance is ${formatUnits(
      desiredTokenAmount
    )} ${symbol}`
  );

  let hasPerformedFirstPass = false;
  let attempts = 0;
  do {
    if (hasPerformedFirstPass) {
      console.log(`Retrying top off for ${prepaidCards.length} prepaid cards`);
    }

    prepaidCards = await topOffPrepaidCards(
      prepaidCards,
      token,
      desiredTokenAmount
    );
    hasPerformedFirstPass = true;
  } while (prepaidCards.length > 0 && attempts++ < 3);
}

async function topOffPrepaidCards(
  prepaidCards: string[],
  token: Contract,
  desiredTokenAmount: BigNumber
): Promise<string[]> {
  let failedTransfers: string[] = [];
  let symbol = await token.symbol();
  for (let [index, prepaidCard] of prepaidCards.entries()) {
    let balance = await token.balanceOf(prepaidCard);
    if (desiredTokenAmount.gt(balance)) {
      let topOffAmount = desiredTokenAmount.sub(balance);
      console.log(
        `Progress ${index + 1} of ${prepaidCards.length} (${Math.round(
          ((index + 1) / prepaidCards.length) * 100
        )}%)
    Prepaid card ${prepaidCard}, has balance of ${formatUnits(
          balance
        )} ${symbol}. Top off amount is ${formatUnits(topOffAmount)} ${symbol}`
      );
      try {
        let tx = await token.transfer(prepaidCard, topOffAmount);
        console.log(`    Top off tx: ${tx.hash}`);
        await tx.wait();
      } catch (err) {
        console.error(err);
        console.error(
          `Top off attempt for ${prepaidCard} failed, will try again`
        );
        failedTransfers.push(prepaidCard);
      }
    }
  }
  return failedTransfers;
}

async function getContractInstance(contractId: string) {
  const proxyAddresses = readAddressFile(network);
  const { contractName, proxy: address } = proxyAddresses[contractId];
  const contractFactory = await makeFactory(contractName);
  return contractFactory.attach(address);
}

asyncMain(main);
