module.exports = {
  env: {
    node: true,
    commonjs: true,
    es2021: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  parserOptions: {
    ecmaVersion: 12,
  },
  plugins: ["@typescript-eslint", "prettier"],
  globals: {
    artifacts: "readonly",
    web3: "readonly",
  },
  ignorePatterns: ["bin/**", "build/**", "coverage/**", "dist/**", "abi/**"],
  rules: {
    "prettier/prettier": "error",
    "prefer-const": "off",
  },
  overrides: [
    {
      files: ["*.js"],
      rules: {
        "@typescript-eslint/no-var-requires": "off",
      },
    },
  ],
};
