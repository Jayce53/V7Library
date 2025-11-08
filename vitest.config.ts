import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isIntegrationRun = process.env.VITEST_MODE === "integration";

export default defineConfig({
  resolve: {
    alias: {
      "#v7": resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ...(isIntegrationRun ? [] : ["tests/integration/**"]),
    ],
    include: isIntegrationRun ? ["tests/integration/**/*.test.ts"] : undefined,
  },
});
