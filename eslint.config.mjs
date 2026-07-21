// eslint.config.mjs
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import jsdoc from "eslint-plugin-jsdoc";
import prettierPlugin from "eslint-plugin-prettier/recommended";
import tailwindCanonical from "eslint-plugin-tailwind-canonical-classes";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // Core ESLint recommended rules - the Next presets do not include these.
  // Must come first: the eslint-recommended layer inside nextTs then switches
  // off the core rules TypeScript itself already enforces (no-undef etc.).
  js.configs.recommended,

  // Next.js core + Core Web Vitals + TS rules
  ...nextVitals,
  ...nextTs,

  // Type-aware TS rules for app code. Scoped to src/ because scripts/ sits
  // outside tsconfig's project graph, so it stays on the non-type-checked
  // recommended set from nextTs.
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ["src/**/*.{ts,tsx}"],
  })),
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The no-unsafe-* family fires ~250 times on any-typed values flowing out
      // of external SDKs (googleapis, JSON parsing). Off until those boundaries
      // get typed; the high-value async-correctness rules below stay on.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      // Async handlers on JSX props (onClick={async ...}) are fine - React
      // ignores the returned promise. Keep the non-attribute checks on.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },

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
    settings: {
      jsdoc: { mode: "typescript" },
    },
    rules: {
      // Core hygiene: require === except the idiomatic `!= null` check
      eqeqeq: ["error", "smart"],

      // TS hygiene
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/consistent-type-definitions": "error",
      "@typescript-eslint/explicit-function-return-type": ["warn", { allowExpressions: true }],

      // Next/React noise
      "react/no-unescaped-entities": "off",

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

  // Tailwind class hygiene. Prettier (via prettier-plugin-tailwindcss) only
  // sorts classes; this rule collapses arbitrary values that have a scale
  // equivalent (max-w-[12rem] > max-w-48) via Tailwind v4's own
  // canonicalizeCandidates API, reading the theme from the CSS entry.
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { "tailwind-canonical-classes": tailwindCanonical },
    rules: {
      "tailwind-canonical-classes/tailwind-canonical-classes": [
        "warn",
        { cssPath: "src/app/globals.css" },
      ],
    },
  },

  // Turn off stylistic rules that clash with Prettier
  prettier,

  // Re-enable prettier/prettier rule so ESLint reports formatting violations
  prettierPlugin,

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
    "next.config.ts",
    "postcss.config.mjs",
    "prettier.config.ts",
    "prisma.config.ts",
    "eslint.config.mjs",
  ]),
]);
