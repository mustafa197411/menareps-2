import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import firebaseConfig from "../../firebase-applet-config.json";
import { connectFirebaseEmulatorsIfApproved } from "./firebaseEmulatorGuard";
import { resolveFrontendFirebaseConfig } from "./firebaseRuntimeConfig";

const hasEnv =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env !== "undefined";

const resolvedConfig = resolveFrontendFirebaseConfig({
  production: hasEnv && import.meta.env.PROD,
  env: {
    apiKey: hasEnv ? import.meta.env.VITE_FIREBASE_API_KEY : undefined,
    authDomain: hasEnv ? import.meta.env.VITE_FIREBASE_AUTH_DOMAIN : undefined,
    projectId: hasEnv ? import.meta.env.VITE_FIREBASE_PROJECT_ID : undefined,
    storageBucket: hasEnv ? import.meta.env.VITE_FIREBASE_STORAGE_BUCKET : undefined,
    messagingSenderId: hasEnv ? import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID : undefined,
    appId: hasEnv ? import.meta.env.VITE_FIREBASE_APP_ID : undefined,
    databaseId: hasEnv ? import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID : undefined,
  },
  bundled: { ...firebaseConfig, databaseId: firebaseConfig.firestoreDatabaseId },
});
const { databaseId: resolvedDatabaseId, ...config } = resolvedConfig;

const app = getApps().length === 0 ? initializeApp(config) : getApp();

function normalizeDatabaseId(value?: string): string | undefined {
  const trimmed = value?.trim();

  if (
    !trimmed ||
    trimmed.toLowerCase() === "default" ||
    trimmed.toLowerCase() === "(default)" ||
    trimmed.toLowerCase() === "[default]"
  ) {
    return undefined;
  }

  return trimmed;
}

const configuredDatabaseId = normalizeDatabaseId(
  resolvedDatabaseId,
);

export const firestoreDatabaseId =
  configuredDatabaseId ?? "(default)";

export const firebaseProjectId = config.projectId;

console.info("FIREBASE INITIALIZATION CHECK", {
  projectId: config.projectId,
  databaseId: firestoreDatabaseId,
  authDomain: config.authDomain,
  storageBucket: config.storageBucket,
});

let db: Firestore;

const enablePersistentCache = false;

if (enablePersistentCache) {
  try {
    db = configuredDatabaseId
      ? initializeFirestore(
          app,
          {
            localCache: persistentLocalCache({
              tabManager: persistentMultipleTabManager(),
            }),
          },
          configuredDatabaseId,
        )
      : initializeFirestore(app, {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        });
  } catch (error) {
    console.warn(
      "[Firebase] Persistent cache initialization failed. Using the standard client.",
      error,
    );

    db = configuredDatabaseId
      ? getFirestore(app, configuredDatabaseId)
      : getFirestore(app);
  }
} else {
  console.info(
    "[Firebase] Using standard in-memory Firestore client.",
  );

  db = configuredDatabaseId
    ? getFirestore(app, configuredDatabaseId)
    : getFirestore(app);
}

const auth = getAuth(app);
const storage = getStorage(app);

connectFirebaseEmulatorsIfApproved({
  auth,
  db,
  storage,
  projectId: config.projectId,
  enabled:
    hasEnv &&
    import.meta.env.VITE_MENAREPS_EMULATOR_MODE === "true",
  authEndpoint:
    hasEnv ? import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL : undefined,
  firestoreHost:
    hasEnv ? import.meta.env.VITE_FIRESTORE_EMULATOR_HOST : undefined,
  storageHost:
    hasEnv ? import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_HOST : undefined,
});

export { app, auth, db, storage };
