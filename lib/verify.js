const { spawn } = require("child_process");

async function verifyImpl(
  address,
  contractName,
  network,
  license = "unlicensed"
) {
  return await new Promise((resolve, reject) => {
    const cmd = `truffle run blockscout ${contractName}@${address} --network ${network} --license ${license}`;
    const p = spawn("npx", cmd.split(" "), {
      stdio: "inherit",
    });
    console.log(`npx ${cmd}`);
    p.on("exit", (code) => resolve(code));
    p.on("error", (code) => reject(code));
  });
}

module.exports = { verifyImpl };
