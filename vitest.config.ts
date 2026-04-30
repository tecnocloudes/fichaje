import { defineConfig } from "vitest/config";
import path from "node:path";

// Tests *.integration.test.ts (con Testcontainers) están excluidos por
// defecto del run rápido. Se ejecutan con `npm run test:integration`.
const INTEGRATION_PATTERN = "src/**/*.integration.test.ts";
const RUN_INTEGRATION = process.env.VITEST_INTEGRATION === "1";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: RUN_INTEGRATION
      ? ["node_modules/**"]
      : ["node_modules/**", INTEGRATION_PATTERN],
    environment: "node",
    testTimeout: RUN_INTEGRATION ? 120_000 : 5_000,
    hookTimeout: RUN_INTEGRATION ? 120_000 : 10_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/tenant/**/*.ts"],
      exclude: ["src/lib/tenant/**/*.test.ts", INTEGRATION_PATTERN],
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
