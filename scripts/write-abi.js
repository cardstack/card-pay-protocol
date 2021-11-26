const glob = require("glob");
const { readFileSync, outputFile } = require("fs-extra");
const prettier = require("prettier");
const kebabCase = require("lodash/kebabCase");

const targetDir = "abi/";

const globPattern = "artifacts/!(build-info)/**/*[!dbg].json";

glob(globPattern, {}, (err, files) => {
  if (err) {
    throw new Error(err);
  }
  files.map((file) => {
    let o;
    o = JSON.parse(readFileSync(file));
    const abi = o["abi"];
    prettier
      .resolveConfig(file)
      .then((options) => {
        console.log(options);
        let fileName = kebabCase(o["contractName"]) + ".ts";
        if (fileName == "i-price-oracle.ts") {
          fileName = "price-oracle.ts";
        }
        const filePath = `${targetDir}${fileName}`;
        const formatted = prettier.format(JSON.stringify(abi, null, 2), {
          ...options,
          parser: "babel",
          singleQuote: true,
        });
        outputFile(
          filePath,
          Buffer.concat([
            Buffer.from("export default "),
            Buffer.from(formatted),
          ])
        );
      })
      .catch((e) => {
        throw new Error(e);
      });
  });
});
