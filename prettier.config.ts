// prettier.config.ts
import type { Config } from "prettier";

const config: Config = {
  $schema: "https://json.schemastore.org/prettierrc",
  plugins: [
    "prettier-plugin-organize-imports",
    "prettier-plugin-packagejson",
    "prettier-plugin-tailwindcss",
  ],
  tailwindStylesheet: "./src/app/globals.css",
  // Sort classes inside cn()/clsx()/twMerge() calls too, not just className attributes.
  tailwindFunctions: ["cn", "clsx", "twMerge"],

  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  jsxSingleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  endOfLine: "lf",

  overrides: [
    { files: ["*.md", "*.mdx"], options: { proseWrap: "always" } },
    { files: ["*.json", "*.yml", "*.yaml"], options: { singleQuote: false } },
  ],
};

export default config;
