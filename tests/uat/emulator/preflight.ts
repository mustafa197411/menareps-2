import { isIP } from "node:net";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MENAREPS_UAT_ENDPOINTS, MENAREPS_UAT_PROJECT_ID } from "../../../src/lib/firebaseEmulatorGuard";
import { sha256, verifyCertifiedRules } from "./certifiedRulesManifest";
import { UAT_ADMIN_STORAGE_ENDPOINT, UAT_ENDPOINTS, UAT_PROJECT_ID, UAT_RULE_HASHES } from "./constants";
import { UAT_IDENTITIES } from "./roles";

function requireValue(actual: string | undefined, expected: string, label: string) {
  if (actual !== expected) throw new Error(`[MENAREPS UAT] ${label} must be exactly ${expected}.`);
}

function requireLoopback(hostPort: string, label: string) {
  const [host, port] = hostPort.split(":");
  if (host !== "127.0.0.1" || isIP(host) !== 4 || !/^\d+$/.test(port ?? "")) {
    throw new Error(`[MENAREPS UAT] ${label} must use an explicit IPv4 loopback endpoint.`);
  }
}

export function assertProductionIsolation(env: NodeJS.ProcessEnv = process.env): void {
  requireValue(UAT_PROJECT_ID, MENAREPS_UAT_PROJECT_ID, "project constant");
  requireValue(env.GCLOUD_PROJECT, UAT_PROJECT_ID, "GCLOUD_PROJECT");
  requireValue(env.GOOGLE_CLOUD_PROJECT, UAT_PROJECT_ID, "GOOGLE_CLOUD_PROJECT");
  requireValue(env.FIREBASE_PROJECT_ID, UAT_PROJECT_ID, "backend Firebase project");
  requireValue(env.FIRESTORE_DATABASE_ID, "(default)", "backend Firestore database");
  requireValue(env.FIREBASE_AUTH_EMULATOR_HOST, UAT_ENDPOINTS.auth, "Auth emulator");
  requireValue(env.FIRESTORE_EMULATOR_HOST, UAT_ENDPOINTS.firestore, "Firestore emulator");
  requireValue(env.FIREBASE_STORAGE_EMULATOR_HOST, UAT_ENDPOINTS.storage, "Storage emulator");
  requireValue(env.STORAGE_EMULATOR_HOST, UAT_ADMIN_STORAGE_ENDPOINT, "Admin Storage emulator");
  const adminStorageUrl = new URL(env.STORAGE_EMULATOR_HOST);
  if (adminStorageUrl.protocol !== "http:" || adminStorageUrl.hostname !== "127.0.0.1" || adminStorageUrl.port !== "9199") {
    throw new Error("[MENAREPS UAT] Admin Storage emulator must use the certified loopback URL.");
  }
  requireValue(env.VITE_MENAREPS_EMULATOR_MODE, "true", "frontend emulator mode");
  requireValue(env.VITE_FIREBASE_PROJECT_ID, UAT_PROJECT_ID, "frontend project");
  requireValue(env.VITE_FIREBASE_AUTH_EMULATOR_URL, MENAREPS_UAT_ENDPOINTS.authUrl, "frontend Auth endpoint");
  requireValue(env.VITE_FIRESTORE_EMULATOR_HOST, MENAREPS_UAT_ENDPOINTS.firestoreHost, "frontend Firestore endpoint");
  requireValue(env.VITE_FIREBASE_STORAGE_EMULATOR_HOST, MENAREPS_UAT_ENDPOINTS.storageHost, "frontend Storage endpoint");
  for (const [label, endpoint] of [["Auth", UAT_ENDPOINTS.auth], ["Firestore", UAT_ENDPOINTS.firestore], ["Storage", UAT_ENDPOINTS.storage]] as const) requireLoopback(endpoint, label);
  if (env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_TOKEN) throw new Error("[MENAREPS UAT] Production-capable credentials are forbidden.");
  const firebaseConfig = JSON.parse(env.FIREBASE_CONFIG ?? "{}") as { projectId?: string };
  requireValue(firebaseConfig.projectId, UAT_PROJECT_ID, "FIREBASE_CONFIG project");
  if (UAT_IDENTITIES.length !== 24) throw new Error("[MENAREPS UAT] All 24 canonical roles are required.");
  const mode = env.MENAREPS_RULES_TEST_MODE;
  if (mode === undefined || mode === "certified") {
    verifyCertifiedRules();
  } else if (mode === "local-candidate") {
    // The suites load these fixed cwd paths. Reject redirection or a different checkout.
    for (const file of ["firestore.rules", "storage.rules"]) {
      const intended = fileURLToPath(new URL(`../../../${file}`, import.meta.url));
      if (realpathSync(file) !== intended || realpathSync(intended) !== intended) {
        throw new Error(`[MENAREPS UAT] Unexpected repository Rules path: ${file}.`);
      }
    }
    if (sha256(readFileSync("storage.rules")) !== UAT_RULE_HASHES.storage) {
      throw new Error("[MENAREPS UAT] Storage Rules do not match the certified hash.");
    }
    console.log(`[MENAREPS UAT] LOCAL CANDIDATE — NOT CERTIFIED: firestore.rules SHA-256=${sha256(readFileSync("firestore.rules"))}`);
  } else {
    throw new Error("[MENAREPS UAT] Unknown MENAREPS_RULES_TEST_MODE.");
  }
}

if (process.argv[1]?.endsWith("preflight.ts")) {
  assertProductionIsolation();
  console.log("MENAREPS_UAT_PREFLIGHT=PASS");
}
