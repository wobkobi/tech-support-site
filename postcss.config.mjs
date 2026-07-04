// postcss.config.mjs

const config = {
  plugins: {
    // Tailwind v4's PostCSS plugin runs Lightning CSS, which already adds vendor
    // prefixes for the browserslist targets. autoprefixer would only re-process
    // the same output, so it is intentionally omitted.
    "@tailwindcss/postcss": {},
  },
};

export default config;
