import { connectAuthEmulator, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { connectStorageEmulator, type FirebaseStorage } from "firebase/storage";

export const MENAREPS_UAT_PROJECT_ID = "demo-menareps-uat";
export const MENAREPS_UAT_ENDPOINTS = Object.freeze({
  authUrl: "http://127.0.0.1:9099",
  firestoreHost: "127.0.0.1:8089",
  storageHost: "127.0.0.1:9199",
});

type EmulatorConnectionOptions = {
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  projectId?: string;
  enabled: boolean;
  authEndpoint?: string;
  firestoreHost?: string;
  storageHost?: string;
};

type ParsedEndpoint = { host: string; port: number };

function parseHostPort(value: string, label: string): ParsedEndpoint {
  const match = /^([^:]+):(\d+)$/.exec(value);
  if (!match) throw new Error(`[MENAREPS UAT] Invalid ${label} endpoint.`);
  return { host: match[1], port: Number(match[2]) };
}

function requireExactEndpoint(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    throw new Error(`[MENAREPS UAT] Refusing non-local ${label} endpoint.`);
  }
}

const connectionState = globalThis as typeof globalThis & {
  __MENAREPS_UAT_EMULATORS_CONNECTED__?: boolean;
};

export function connectFirebaseEmulatorsIfApproved(options: EmulatorConnectionOptions): boolean {
  if (!options.enabled) return false;

  if (options.projectId !== MENAREPS_UAT_PROJECT_ID) {
    throw new Error("[MENAREPS UAT] Emulator mode requires the exact demo-menareps-uat project.");
  }

  const authUrl = options.authEndpoint ?? MENAREPS_UAT_ENDPOINTS.authUrl;
  const firestoreHost = options.firestoreHost ?? MENAREPS_UAT_ENDPOINTS.firestoreHost;
  const storageHost = options.storageHost ?? MENAREPS_UAT_ENDPOINTS.storageHost;

  requireExactEndpoint(authUrl, MENAREPS_UAT_ENDPOINTS.authUrl, "Auth");
  requireExactEndpoint(firestoreHost, MENAREPS_UAT_ENDPOINTS.firestoreHost, "Firestore");
  requireExactEndpoint(storageHost, MENAREPS_UAT_ENDPOINTS.storageHost, "Storage");

  if (connectionState.__MENAREPS_UAT_EMULATORS_CONNECTED__) return true;

  const firestore = parseHostPort(firestoreHost, "Firestore");
  const storage = parseHostPort(storageHost, "Storage");
  connectAuthEmulator(options.auth, authUrl, { disableWarnings: true });
  connectFirestoreEmulator(options.db, firestore.host, firestore.port);
  connectStorageEmulator(options.storage, storage.host, storage.port);
  connectionState.__MENAREPS_UAT_EMULATORS_CONNECTED__ = true;
  return true;
}
