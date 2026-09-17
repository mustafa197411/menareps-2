import {
  applicationDefault,
  getApps,
  initializeApp,
  type App
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getFirebaseRuntimeIdentity } from "./firebaseRuntimeIdentity";

let adminServices: {
  auth: ReturnType<typeof getAuth>;
  db: ReturnType<typeof getFirestore>;
  storage: ReturnType<typeof getStorage>;
} | null = null;

let initializationError: Error | null = null;
let hasLoggedIdentity = false;

async function logDiagnosticIdentity() {
  if (hasLoggedIdentity) return;
  hasLoggedIdentity = true;

  let email = "unknown-service-account@gserviceaccount.com";
  let type = "Application Default Credentials";

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1000);
    const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email", {
      headers: { "Metadata-Flavor": "Google" },
      signal: controller.signal
    });
    clearTimeout(id);
    if (res.ok) {
      email = (await res.text()).trim();
      type = "Compute Engine / Cloud Run Instance Identity";
    }
  } catch (e) {
    // Possibly running locally or offline
    type = "Application Default Credentials (Local Fallback)";
  }

  console.info("\n=========================================================");
  console.info("[Firebase Admin Identity]");
  console.info(`Project ID: ${getFirebaseRuntimeIdentity().projectId}`);
  console.info(`Principal: ${email}`);
  console.info(`Credential Type: ${type}`);
  console.info("=========================================================\n");
}

export function getFirebaseAdminServices() {
  if (adminServices) {
    return adminServices;
  }

  if (initializationError) {
    throw initializationError;
  }

  try {
    const { projectId, databaseId } = getFirebaseRuntimeIdentity();
    const app =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            credential: applicationDefault(),
            projectId: projectId
          });

    const isDefaultDb = !databaseId || 
      databaseId === "(default)" || 
      databaseId === "default" || 
      databaseId === "[default]";

    adminServices = {
      auth: getAuth(app),
      storage: getStorage(app),
      db: isDefaultDb
        ? getFirestore(app)
        : getFirestore(app, databaseId)
    };

    console.info("[Firebase Admin] Lazily initialized successfully with Application Default Credentials.");
    
    // Trigger identity discovery diagnostic asynchronously without blocking
    logDiagnosticIdentity().catch(() => {});

    return adminServices;
  } catch (error) {
    initializationError =
      error instanceof Error
        ? error
        : new Error(String(error));
    console.warn("[Firebase Admin] Lazy initialization failed (credentials likely unavailable):", initializationError.message);
    throw initializationError;
  }
}

export function isFirebaseAdminAvailable(): boolean {
  try {
    getFirebaseAdminServices();
    return true;
  } catch {
    return false;
  }
}
