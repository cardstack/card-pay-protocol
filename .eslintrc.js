module.exports = {
  env: {
    node: true,
    commonjs: true,
    es2021: true,
  },
  extends: ["eslint:recommended", "prettier"],
  parserOptions: {
    ecmaVersion: 12,
  },
  globals: {
    artifacts: "readonly",
    web3: "readonly",
  },
  ignorePatterns: ["bin/**", "build/**", "coverage/**"],
  rules: {},
};
