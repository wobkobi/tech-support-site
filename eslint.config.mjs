// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import jsdoc from "eslint-plugin-jsdoc";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

export default defineConfig([
  // Next.js core + Core Web Vitals + TS rules
  ...nextVitals,
  ...nextTs,

  // JSDoc baseline (flat config variant, tuned for TS)
  jsdoc.configs["flat/recommended-typescript-error"],

  // Your project-specific TS + JSDoc rules
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      // Next config already sets parser; here we only tweak globals
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      jsdoc,
    },
    settings: {
      jsdoc: { mode: "typescript" },
    },
    rules: {
      // TS hygiene
      "@typescript-eslint/no-unused-vars": "error",
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/consistent-type-definitions": "error",
      "@typescript-eslint/explicit-function-return-type": ["warn", { allowExpressions: true }],

      // JSDoc enforcement
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            FunctionDeclaration: true,
            FunctionExpression: true,
            ArrowFunctionExpression: true,
            MethodDefinition: true,
          },
        },
      ],
      "jsdoc/require-param": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-undefined-types": "error",
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns-type": "off",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-description": "error",
    },
  },

  // Turn off stylistic rules that clash with Prettier
  prettier,

  // Ignores (this replaces your manual ignores + Next defaults)
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "node_modules/**",
    "dist/**",
    "coverage/**",
    ".turbo/**",
    ".eslintcache",
    "next.config.mjs",
    "postcss.config.js",
    "eslint.config.mjs",
  ]),
]);
