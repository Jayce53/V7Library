const globals = require("globals");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true,
  },
  settings: {
    "import/resolver": {
      typescript: {
        project: "./tsconfig.json",
      },
    },
  },
  parserOptions: {
    project: ["./tsconfig.json"],
    tsconfigRootDir: __dirname,
  },
  extends: ["airbnb-base", "airbnb-typescript/base"],
  ignorePatterns: ["dist/", "node_modules/", ".yarn/", ".pnp.cjs"],
  rules: {
    "max-len": [
      "error",
      {
        code: 150,
        tabWidth: 2,
        ignoreUrls: true,
        ignoreTemplateLiterals: true,
      },
    ],
    "@typescript-eslint/comma-dangle": "off",
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {argsIgnorePattern: "^_", varsIgnorePattern: "^_"},
    ],
    "@typescript-eslint/lines-between-class-members": "off",
    "@typescript-eslint/quotes": ["error", "double", {avoidEscape: true}],
    "no-plusplus": "off",
    quotes: ["error", "double", {avoidEscape: true}],
    "object-curly-spacing": ["error", "never"],
    "@typescript-eslint/object-curly-spacing": ["error", "never"],
    "object-curly-newline": "off",
    "no-console": "off",
    "import/extensions": "off",
    "linebreak-style": "off",
  },
  overrides: [
    {
      files: ["tests/**/*.ts"],
      globals: {
        ...globals.vitest,
      },
      rules: {
        "@typescript-eslint/no-empty-function": "off",
        "@typescript-eslint/no-useless-constructor": "off",
        "class-methods-use-this": "off",
      },
    },
  ],
};
