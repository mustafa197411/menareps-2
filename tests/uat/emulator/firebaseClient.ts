import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { UAT_ENDPOINTS, UAT_PROJECT_ID, UAT_STORAGE_BUCKET } from "./constants";

export function createEmulatorClient(name: string) {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${UAT_PROJECT_ID}.firebaseapp.com`,
    projectId: UAT_PROJECT_ID,
    storageBucket: UAT_STORAGE_BUCKET,
    appId: `demo:${name}`,
  }, `${name}-${getApps().length}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  connectAuthEmulator(auth, `http://${UAT_ENDPOINTS.auth}`, { disableWarnings: true });
  const [firestoreHost, firestorePort] = UAT_ENDPOINTS.firestore.split(":");
  const [storageHost, storagePort] = UAT_ENDPOINTS.storage.split(":");
  connectFirestoreEmulator(db, firestoreHost, Number(firestorePort));
  connectStorageEmulator(storage, storageHost, Number(storagePort));
  return { app, auth, db, storage };
}
