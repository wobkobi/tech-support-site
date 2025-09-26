// eslint.config.mjs
import {FlatCompat} from "@eslint/eslintrc";
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import jsdoc from "eslint-plugin-jsdoc";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal compat to use classic shareable configs
const compat = new FlatCompat({baseDirectory: __dirname});

export default [
  // Ignore globs
  {
    ignores: ["**/node_modules/**", "**/.next/**", "dist/**", "coverage/**", "build/**", ".turbo/**", ".eslintcache", "next.config.mjs", "postcss.config.js", "eslint.config.mjs"],
  },

  // JSDoc rules tuned for TypeScript (error-level)
  jsdoc.configs["flat/recommended-typescript-error"],

  // Baselines: JS, TS, Next.js; and disable stylistic conflicts via Prettier config
  js.configs.recommended,
  ...compat.extends("plugin:@typescript-eslint/recommended", "plugin:@next/next/recommended", "plugin:@next/next/core-web-vitals"),
  prettierConfig,

  // Project rules
  {
    languageOptions: {
      parser: tsParser,
      // Keep globals explicit; parserOptions.project omitted for speed
      globals: {...globals.browser, ...globals.node},
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      jsdoc,
    },
    settings: {
      jsdoc: {mode: "typescript"},
    },
    rules: {
      // TS hygiene
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/consistent-type-definitions": "error",
      "@typescript-eslint/explicit-function-return-type": ["warn", {allowExpressions: true}],

      // JSDoc enforcement (tighten or relax as needed)
      "jsdoc/require-jsdoc": "error",
      "jsdoc/require-param": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-undefined-types": "error",

      // Formatting handled by Prettier (run separately), no plugin here
    },
  },
];
