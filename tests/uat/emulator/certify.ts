import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { assertProductionIsolation } from "./preflight";
import { resetEmulatorState } from "./reset";
import { seedEmulatorState } from "./seed";
import { uatEnvironment } from "./constants";

const rulesMode = process.env.MENAREPS_RULES_TEST_MODE;
if (rulesMode !== undefined && rulesMode !== "certified") {
  throw new Error("[MENAREPS UAT] Certification requires certified Rules mode; local candidates and unknown modes are forbidden.");
}

const runSecret = randomBytes(32).toString("hex");
const env = { ...process.env, ...uatEnvironment(runSecret) };
Object.assign(process.env, env);
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_TOKEN;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { env: process.env, stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error(`[MENAREPS UAT] ${command} ${args.join(" ")} failed with ${result.status}.`);
}

assertProductionIsolation();
await seedEmulatorState();
try {
  run(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.uat.config.ts"]);
  if (process.env.MENAREPS_UAT_SKIP_BROWSER !== "true") {
    const focusedBrowserFiles = (process.env.MENAREPS_UAT_PLAYWRIGHT_FILES || "").split(",").map(value => value.trim()).filter(Boolean);
    run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.uat.config.ts", ...focusedBrowserFiles]);
  }
  console.log("MENAREPS_UAT_CERTIFICATION=PASS");
} finally {
  await resetEmulatorState();
}
