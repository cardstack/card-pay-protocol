import retry from "async-retry";

import hre from "hardhat";
const { ethers } = hre;
import { patchNetworks, asyncMain, readAddressFile, getSigner } from "./util";
import { AddressFile, getAddress } from "./config-utils";
patchNetworks();

const {
  network: { name: network },
} = hre;

async function main(proxyAddresses: AddressFile) {
  proxyAddresses = proxyAddresses || readAddressFile(network);
  let cardUsdFeedAddress = getAddress("CARDUSDFeed", proxyAddresses);

  let signer = getSigner();

  let price = process.env.CARD_USD_PRICE;

  if (!price) {
    throw new Error("Must provide env variable CARD_USD_PRICE");
  }

  let startedAt = Math.floor(Date.now() / 1000);
  let updatedAt = startedAt;
  await retry(
    async () => {
      console.log(
        `  adding round: price ${price}, startedAt(unix) ${startedAt}, updatedAt(unix) ${updatedAt}`
      );

      let instance = (
        await ethers.getContractAt("ManualFeed", cardUsdFeedAddress)
      ).connect(signer);
      await instance.addRound(price, startedAt, updatedAt);
    },
    {
      retries: 3,
    }
  );
}

asyncMain(main);
