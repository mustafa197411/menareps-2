import fs from "fs";
import path from "path";

export interface FirebaseRuntimeIdentity {
  projectId: string;
  databaseId: string;
  emulator: boolean;
}

type RuntimeEnvironment = Record<string, string | undefined>;

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`FIREBASE_RUNTIME_IDENTITY_REQUIRED:${name}`);
  return normalized;
}

function isLoopback(value: string): boolean {
  const host = value.replace(/^https?:\/\//, "").split(":")[0];
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function resolveFirebaseRuntimeIdentity(env: RuntimeEnvironment): FirebaseRuntimeIdentity {
  const projectId = required(env.FIREBASE_PROJECT_ID, "FIREBASE_PROJECT_ID");
  const databaseId = required(env.FIRESTORE_DATABASE_ID, "FIRESTORE_DATABASE_ID");
  const emulatorHosts = [env.FIRESTORE_EMULATOR_HOST, env.FIREBASE_AUTH_EMULATOR_HOST, env.FIREBASE_STORAGE_EMULATOR_HOST]
    .filter((value): value is string => Boolean(value?.trim()));
  const emulator = emulatorHosts.length > 0;

  if (env.GOOGLE_CLOUD_PROJECT?.trim() && env.GOOGLE_CLOUD_PROJECT.trim() !== projectId) {
    throw new Error("FIREBASE_RUNTIME_PROJECT_MISMATCH:GOOGLE_CLOUD_PROJECT");
  }
  if (emulator) {
    if (!projectId.startsWith("demo-") || emulatorHosts.some((host) => !isLoopback(host))) {
      throw new Error("FIREBASE_EMULATOR_IDENTITY_NOT_ISOLATED");
    }
  }
  return { projectId, databaseId, emulator };
}

export function readCommittedFirebaseIdentity(): { projectId?: string; databaseId?: string } {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (!fs.existsSync(configPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return { projectId: parsed.projectId, databaseId: parsed.firestoreDatabaseId };
}

export function getFirebaseRuntimeIdentity(): FirebaseRuntimeIdentity {
  const identity = resolveFirebaseRuntimeIdentity(process.env);
  if (!identity.emulator) {
    const committed = readCommittedFirebaseIdentity();
    if (committed.projectId && committed.projectId !== identity.projectId) {
      throw new Error("FIREBASE_RUNTIME_PROJECT_MISMATCH:COMMITTED_CONFIG");
    }
    if (committed.databaseId && committed.databaseId !== identity.databaseId) {
      throw new Error("FIREBASE_RUNTIME_DATABASE_MISMATCH:COMMITTED_CONFIG");
    }
  }
  return identity;
}
