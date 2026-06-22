import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup-env.ts"],
    testTimeout: 15000,
  },
});
