import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: true,
    coverage: {
      reporter: ["text", "html"],
      enabled: true,
      // threshold property removed; not valid for coverage config
    },
  },
});
