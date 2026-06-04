/** ESLint config — flat config, browser + chrome globals, content-script files relaxed. */
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        chrome: "readonly",
        SkippyStorage: "readonly",
        SkippyCore: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-empty": "off",
      "no-unused-vars": "off",
    },
  },
  {
    ignores: ["dist/**", "types/**", "node_modules/**", "coverage/**"],
  },
];
