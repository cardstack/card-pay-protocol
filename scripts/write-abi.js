const glob = require("glob");
const { readFileSync, outputFile } = require("fs-extra");
const prettier = require("prettier");
const kebabCase = require("lodash/kebabCase");

const targetDir = "abi/";

const globPattern = "artifacts/!(build-info)/**/[!I]*[!dbg].json";

glob(globPattern, {}, (err, files) => {
  files.map((file) => {
    let o;
    try {
      o = JSON.parse(readFileSync(file));
    } catch (e) {
      console.log(e);
    }
    const abi = o["abi"];
    prettier
      .resolveConfig(file)
      .then((options) => {
        const fileName = kebabCase(o["contractName"]) + ".ts";
        const filePath = `${targetDir}${fileName}`;
        const formatted = prettier.format(JSON.stringify(abi, null, 2), {
          ...options,
          parser: "babel",
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
        console.log(e);
      });
  });
});
