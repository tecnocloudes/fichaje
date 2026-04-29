import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/tenant/**/*.ts"],
      exclude: ["src/lib/tenant/**/*.test.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
