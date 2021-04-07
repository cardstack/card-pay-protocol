const config = require("../.eslintrc.js");
module.exports = Object.assign({}, config, {
  globals: {
    web3: "readonly",
    artifacts: "readonly",
    contract: "readonly",
    before: "readonly",
    beforeEach: "readonly",
    after: "readonly",
    afterEach: "readonly",
    describe: "readonly",
    it: "readonly",
  },
});
