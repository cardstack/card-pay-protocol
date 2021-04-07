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
  },
  ignorePatterns: ["bin/**", "build/**", "coverage/**"],
  rules: {},
};
