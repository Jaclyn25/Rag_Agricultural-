export default [
  {
    ignores: ["node_modules/**", "data/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        crypto: "readonly",
        setTimeout: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Headers: "readonly",
        Request: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "prefer-const": "warn",
      "no-var": "error",
      "eqeqeq": ["warn", "always"],
      "no-console": "off",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        navigator: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
];
