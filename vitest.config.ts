import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: true,
    coverage: {
      reporter: ["text", "html", "json-summary", "json"],
      include: ["src/**/lib/**", "src/app/api/**"],
    },
  },
});
