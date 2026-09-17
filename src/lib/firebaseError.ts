import { auth, firebaseProjectId, firestoreDatabaseId } from "./firebase";

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
  classification?: 'permission-denied' | 'unavailable' | 'not-found' | 'deadline-exceeded' | 'unknown';
  code?: string;
  retryAttempted?: boolean;
  retryResult?: string;
  finalCloudState?: string;
}

// Keep track of the last firestore error so we can notify listeners
export let lastFirestoreError: FirestoreErrorInfo | null = null;
const errorListeners: ((err: FirestoreErrorInfo | null) => void)[] = [];

export function addFirestoreErrorListener(listener: (err: FirestoreErrorInfo | null) => void) {
  errorListeners.push(listener);
  if (lastFirestoreError) {
    listener(lastFirestoreError);
  }
  return () => {
    const idx = errorListeners.indexOf(listener);
    if (idx !== -1) {
      errorListeners.splice(idx, 1);
    }
  };
}

export function clearFirestoreError(): void {
  lastFirestoreError = null;
  errorListeners.forEach(listener => {
    try {
      listener(null);
    } catch (e) {
      console.error("[FirebaseSync] Error in Firestore error listener callback during clear:", e);
    }
  });
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  writtenObject?: any,
  retryAttempted: boolean = false,
  retryResult: string = "N/A",
  finalCloudState: string = "N/A",
  removedUndefinedFieldPaths?: string[]
): void {
  const errCode = (error as any)?.code || "N/A";
  const errMessage = (error as any)?.message || (error instanceof Error ? error.message : String(error));
  const currentUserObj = typeof window !== "undefined" ? (window as any).currentUser : null;
  const currentRole = currentUserObj?.role || "N/A";
  const authUid = auth.currentUser?.uid || currentUserObj?.id || "N/A";

  // Parse document ID from path if possible (e.g. physicians/P123 -> P123)
  const docId = path && path.includes("/") ? path.split("/").pop() : "N/A";

  console.error("=== FIRESTORE ERROR DIAGNOSTIC ===");
  console.error("1. Operation Type:", operationType);
  console.error("2. Collection/Path:", path);
  console.error("3. Document ID:", docId);
  console.error("4. Complete Object Being Written:", writtenObject);
  console.error("5. Removed Undefined Field Paths:", removedUndefinedFieldPaths || []);
  console.error("6. Current Auth UID:", authUid);
  console.error("7. Current User Role:", currentRole);
  console.error("8. Firebase Error Code:", errCode);
  console.error("9. Firebase Error Message:", errMessage);
  console.error("10. Firebase Project ID:", firebaseProjectId);
  console.error("11. Firestore Database ID:", firestoreDatabaseId);
  console.error("12. Retry Attempted:", retryAttempted);
  console.error("13. Retry Result:", retryResult);
  console.error("14. Final Cloud State:", finalCloudState);
  console.error("==================================");

  let classification: 'permission-denied' | 'unavailable' | 'not-found' | 'deadline-exceeded' | 'unknown' = 'unknown';
  const lowercaseCode = String(errCode).toLowerCase();
  const lowercaseMsg = String(errMessage).toLowerCase();

  if (lowercaseCode === 'permission-denied' || lowercaseMsg.includes('permission-denied') || lowercaseMsg.includes('permission denied')) {
    classification = 'permission-denied';
  } else if (lowercaseCode === 'unavailable' || lowercaseMsg.includes('offline') || lowercaseMsg.includes('unavailable')) {
    classification = 'unavailable';
  } else if (lowercaseCode === 'not-found' || lowercaseMsg.includes('not-found') || lowercaseMsg.includes('not found')) {
    classification = 'not-found';
  } else if (lowercaseCode === 'deadline-exceeded' || lowercaseMsg.includes('timeout') || lowercaseMsg.includes('deadline-exceeded')) {
    classification = 'deadline-exceeded';
  }

  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: authUid,
      email: auth.currentUser?.email || currentUserObj?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path,
    classification,
    code: errCode,
    retryAttempted,
    retryResult,
    finalCloudState
  };
  console.warn('[FirebaseSync Warning] Firestore operation failed:', errInfo);
  lastFirestoreError = errInfo;
  errorListeners.forEach(listener => {
    try {
      listener(errInfo);
    } catch (e) {
      console.error("[FirebaseSync] Error in Firestore error listener callback:", e);
    }
  });
}

