import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/uat/emulator/*.test.ts"],
    exclude: ["tests/uat/emulator/noIdentityAllowlist.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
