import { Request, Response, NextFunction } from "express";
import { getFirebaseAdminServices } from "./firebaseAdmin";
import { getFirebaseRuntimeIdentity } from "./firebaseRuntimeIdentity";

let hasLoggedSandboxWarning = false;


export interface AuthenticatedRequest extends Request {
  user?: any;
  authUid?: string;
}

function parseFirestoreValue(valueObj: any): any {
  if (!valueObj) return null;
  const types = ['stringValue', 'booleanValue', 'integerValue', 'doubleValue', 'mapValue', 'arrayValue', 'nullValue', 'timestampValue'];
  for (const t of types) {
    if (t in valueObj) {
      if (t === 'mapValue') {
        return parseFirestoreFields(valueObj.mapValue.fields || {});
      }
      if (t === 'arrayValue') {
        const values = valueObj.arrayValue.values || [];
        return values.map((v: any) => parseFirestoreValue(v));
      }
      if (t === 'integerValue') {
        return parseInt(valueObj.integerValue, 10);
      }
      if (t === 'doubleValue') {
        return parseFloat(valueObj.doubleValue);
      }
      if (t === 'nullValue') {
        return null;
      }
      return valueObj[t];
    }
  }
  return null;
}

function parseFirestoreFields(fields: any): any {
  const result: any = {};
  if (!fields) return result;
  for (const key of Object.keys(fields)) {
    result[key] = parseFirestoreValue(fields[key]);
  }
  return result;
}

async function fetchUserProfileViaRest(uid: string, token: string): Promise<any> {
  const { databaseId: dbId, projectId: projId } = getFirebaseRuntimeIdentity();

  const docUrl = `https://firestore.googleapis.com/v1/projects/${projId}/databases/${dbId}/documents/users/${uid}`;
  console.info(`[AUTH FALLBACK] Attempting REST lookup for UID ${uid} on database ${dbId}...`);

  try {
    const response = await fetch(docUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (response.ok) {
      const docData = await response.json();
      console.info("[AUTH FALLBACK] REST lookup succeeded for UID:", uid);
      return parseFirestoreFields(docData.fields);
    } else {
      console.warn(`[AUTH FALLBACK] REST lookup failed with status: ${response.status}`);
    }
  } catch (err: any) {
    console.error("[AUTH FALLBACK] REST lookup error:", err.message);
  }

  return null;
}

export async function requireFirebaseAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  // 1. Validate Token Presence First
  if (!authHeader) {
    console.warn("[AUTH MIDDLEWARE] Missing Authorization header.");
    return res.status(401).json({ error: "Unauthorized: Missing Authorization header." });
  }

  // 2. Validate Bearer format
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    console.warn("[AUTH MIDDLEWARE] Malformed Authorization header. Expected 'Bearer <token>'.");
    return res.status(401).json({ error: "Unauthorized: Malformed Authorization header. Expected 'Bearer <token>'." });
  }

  const token = parts[1];
  if (!token || token.trim() === "") {
    console.warn("[AUTH MIDDLEWARE] Empty token provided.");
    return res.status(401).json({ error: "Unauthorized: Empty token." });
  }

  // 3. Resolve Firebase Admin Services lazily
  let adminAuth;
  let adminDb;

  try {
    const services = getFirebaseAdminServices();
    adminAuth = services.auth;
    adminDb = services.db;
  } catch (initErr: any) {
    console.warn("[AUTH MIDDLEWARE] Secure Firebase Admin credentials are unavailable. Denying with 503.", initErr.message || initErr);
    return res.status(503).json({
      error: "Authentication service temporarily unavailable",
      code: "AUTH_SERVICE_UNAVAILABLE"
    });
  }

  // 4. Perform Authentication Checks
  let decodedToken;
  try {
    // Verify token securely using verified Firebase Admin SDK
    decodedToken = await adminAuth.verifyIdToken(token);
  } catch (error: any) {
    console.error("[AUTH MIDDLEWARE] Token verification failed:", error.message || error);
    return res.status(401).json({
      error: "Unauthorized: Invalid or expired token.",
      code: "INVALID_FIREBASE_TOKEN"
    });
  }

  const uid = decodedToken.uid;

  // 5. Fetch user profile from authoritative Firestore 'users' collection
  let userData = null;
  let lookupError = null;

  // Try Admin SDK first as the primary production-grade lookup mechanism
  try {
    const userDoc = await adminDb.collection("users").doc(uid).get();
    userData = userDoc.exists ? userDoc.data() : null;
  } catch (error: any) {
    lookupError = error;
    
    // Check if error is related to Firestore permissions
    const isPermissionError = error.code === 7 || 
      String(error.message || "").toLowerCase().includes("permission") ||
      String(error.message || "").toLowerCase().includes("insufficient");

    if (isPermissionError) {
      if (!hasLoggedSandboxWarning) {
        hasLoggedSandboxWarning = true;
        console.warn(
          "[AUTH MIDDLEWARE] Admin SDK profile lookup failed due to expected sandbox IAM cross-project restrictions (7 PERMISSION_DENIED). " +
          "Invoking robust token-verified REST API fallback. This warning is logged once."
        );
      }
    } else {
      console.warn(`[AUTH MIDDLEWARE] Admin SDK profile lookup failed: ${error.message || error}`);
    }
  }

  // REST Fallback: Only run if Admin SDK threw an error (e.g., sandbox IAM restrictions)
  if (!userData && lookupError) {
    try {
      userData = await fetchUserProfileViaRest(uid, token);
    } catch (restError: any) {
      console.error("[AUTH MIDDLEWARE] REST fallback profile lookup failed as well:", restError.message || restError);
    }
  }

  // If we couldn't resolve the user data and we encountered a service permissions/lookup error
  if (!userData && lookupError) {
    console.error("[AUTH MIDDLEWARE] Firestore profile lookup failed (Missing or insufficient permissions):", lookupError.message || lookupError);
    return res.status(503).json({
      error: "Authentication service temporarily unavailable: user profile lookup failed",
      code: "USER_PROFILE_LOOKUP_FAILED"
    });
  }

  if (!userData) {
    console.warn(`[AUTH MIDDLEWARE] Authenticated UID ${uid} has no profile in 'users' collection.`);
    return res.status(403).json({ error: "Forbidden: User profile not found in database." });
  }

  // Status / permission checks
  if (userData.isDeleted === true || userData.isDeleted === "true") {
    console.warn(`[AUTH MIDDLEWARE] User ${uid} account is marked as deleted.`);
    return res.status(403).json({ error: "Forbidden: Account has been terminated." });
  }

  if (userData.active === false || userData.active === "false" || userData.status === "Inactive" || userData.employmentStatus === "Inactive") {
    console.warn(`[AUTH MIDDLEWARE] User ${uid} account is inactive.`);
    return res.status(403).json({ error: "Forbidden: Account is inactive." });
  }

  if (userData.employmentStatus === "Suspended") {
    console.warn(`[AUTH MIDDLEWARE] User ${uid} account is suspended.`);
    return res.status(403).json({ error: "Forbidden: Account is suspended." });
  }

  if (userData.loginAllowed === false || userData.loginAllowed === "false") {
    console.warn(`[AUTH MIDDLEWARE] User ${uid} has loginAllowed = false.`);
    return res.status(403).json({ error: "Forbidden: Login permission disabled by administrator." });
  }

  // Attach trusted user profile to request (this is our authoritative, non-forgeable source of identity)
  req.user = userData;
  req.authUid = uid;
  next();
}
