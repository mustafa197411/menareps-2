import { defineConfig } from "@playwright/test";
import { UAT_BASE_URL } from "./tests/uat/emulator/constants";

export default defineConfig({
  testDir: "./tests/uat/emulator",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL: UAT_BASE_URL,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run uat:emulator:app",
    url: UAT_BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, PORT: "4178", NODE_ENV: "development", DISABLE_HMR: "true" },
  },
});
