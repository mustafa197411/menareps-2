import { getFirebaseAdminServices } from "./firebaseAdmin";
import { removeUndefinedRecursively } from "../src/utils/importNormalization";

export interface ClaimActivationResult {
  success: boolean;
  status: "SUCCESS" | "ACTIVATION_NOT_FOUND" | "ACTIVATION_ALREADY_USED" | "EMAIL_MISMATCH" | "IDENTITY_CONFLICT" | "ACTIVATION_DISABLED" | "ERROR";
  uid?: string;
  email?: string;
  role?: string;
  profileCreated?: boolean;
  activationClaimed?: boolean;
  conflict?: boolean;
  user?: any;
  error?: string;
}

export function getEmailKey(email: string): string {
  return (email || "").trim().toLowerCase().replace(/@/g, "-").replace(/\./g, "-");
}

/**
 * Trusted Backend Activation Claim Service using Firebase Admin SDK.
 * Verifies Firebase ID token, validates activation profile server-side,
 * enforces canonical users/{uid} document creation, detects identity conflicts,
 * and performs atomic transaction without trusting client payload.
 */
export async function claimActivationProfileServer(idToken: string): Promise<ClaimActivationResult> {
  if (!idToken || typeof idToken !== "string" || idToken.trim() === "") {
    return {
      success: false,
      status: "ERROR",
      error: "Missing or invalid Authorization token."
    };
  }

  let adminAuth;
  let adminDb;

  try {
    const services = getFirebaseAdminServices();
    adminAuth = services.auth;
    adminDb = services.db;
  } catch (initErr: any) {
    console.error("[AuthActivationService] Firebase Admin services unavailable:", initErr);
    return {
      success: false,
      status: "ERROR",
      error: "Firebase Admin authentication service unavailable."
    };
  }

  // 1. Verify the Firebase ID token using Admin Auth
  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(idToken);
  } catch (verifyErr: any) {
    console.warn("[AuthActivationService] ID token verification failed:", verifyErr.message || verifyErr);
    return {
      success: false,
      status: "ERROR",
      error: "Unauthorized: Invalid or expired Firebase ID token."
    };
  }

  const uid = decodedToken.uid;
  const verifiedEmail = (decodedToken.email || "").trim().toLowerCase();

  if (!uid || !verifiedEmail) {
    return {
      success: false,
      status: "ERROR",
      error: "Authenticated token missing required uid or email claim."
    };
  }

  const emailKey = getEmailKey(verifiedEmail);

  // 2. Idempotency Check: if users/{uid} already exists, return it cleanly
  try {
    const existingUserDoc = await adminDb.collection("users").doc(uid).get();
    if (existingUserDoc.exists) {
      const existingUser = existingUserDoc.data();
      if (existingUser && (existingUser.email || "").toLowerCase() === verifiedEmail) {
        return {
          success: true,
          status: "SUCCESS",
          uid,
          email: verifiedEmail,
          role: existingUser.role,
          profileCreated: false,
          activationClaimed: false,
          conflict: false,
          user: existingUser
        };
      }
    }
  } catch (checkErr: any) {
    console.warn("[AuthActivationService] Idempotency user check warning:", checkErr.message);
  }

  // 3. Read activation profile server-side
  let actSnap;
  try {
    actSnap = await adminDb.collection("userActivationProfiles").doc(emailKey).get();
  } catch (actErr: any) {
    console.error("[AuthActivationService] Failed reading userActivationProfiles:", actErr);
    return {
      success: false,
      status: "ERROR",
      error: "Database error while verifying activation profile."
    };
  }

  if (!actSnap.exists) {
    return {
      success: false,
      status: "ACTIVATION_NOT_FOUND",
      error: "No administrator-created activation profile was found for this email. Please contact your administrator to register your email first."
    };
  }

  const actData = actSnap.data() || {};

  // 4. Validate Activation Profile Eligibility
  const actEmail = (actData.email || "").trim().toLowerCase();
  if (actEmail !== verifiedEmail) {
    return {
      success: false,
      status: "EMAIL_MISMATCH",
      error: `Activation email mismatch: profile is registered for '${actEmail}' but token email is '${verifiedEmail}'.`
    };
  }

  if (actData.isDeleted === true) {
    return {
      success: false,
      status: "ACTIVATION_NOT_FOUND",
      error: "This activation profile has been deleted by an administrator."
    };
  }

  if (actData.active === false || actData.loginAllowed === false || actData.status === "Inactive") {
    return {
      success: false,
      status: "ACTIVATION_DISABLED",
      error: "Your account has been deactivated by an administrator. Please contact support."
    };
  }

  if (actData.used === true) {
    if (actData.linkedToUid === uid) {
      // Re-fetch users/{uid} if it was created previously
      const userDoc = await adminDb.collection("users").doc(uid).get();
      if (userDoc.exists) {
        return {
          success: true,
          status: "SUCCESS",
          uid,
          email: verifiedEmail,
          role: userDoc.data()?.role,
          profileCreated: false,
          activationClaimed: false,
          conflict: false,
          user: userDoc.data()
        };
      }
    } else {
      return {
        success: false,
        status: "ACTIVATION_ALREADY_USED",
        error: "This activation profile has already been used and linked to another account."
      };
    }
  }

  // 5. Identity Conflict Detection: Check if another document exists in 'users' for this email
  try {
    const conflictQuery = await adminDb.collection("users").where("email", "==", verifiedEmail).get();
    for (const docSnap of conflictQuery.docs) {
      if (docSnap.id !== uid) {
        const docData = docSnap.data();
        if (!docData.isDeleted && !docData.archived) {
          console.warn(`[AuthActivationService] IDENTITY CONFLICT DETECTED: Existing profile users/${docSnap.id} differs from Auth UID users/${uid}`);
          return {
            success: false,
            status: "IDENTITY_CONFLICT",
            conflict: true,
            error: `Identity conflict: A user profile already exists for ${verifiedEmail} with ID '${docSnap.id}', which differs from authenticated UID '${uid}'.`
          };
        }
      }
    }
  } catch (conflictErr: any) {
    console.warn("[AuthActivationService] Identity conflict check error:", conflictErr.message);
  }

  // 6. Admin SDK Atomic Transaction
  const now = new Date().toISOString();
  let createdUserPayload: any = null;

  try {
    await adminDb.runTransaction(async (transaction) => {
      const actRef = adminDb.collection("userActivationProfiles").doc(emailKey);
      const userRef = adminDb.collection("users").doc(uid);

      const freshActSnap = await transaction.get(actRef);
      if (!freshActSnap.exists) {
        throw new Error("ACTIVATION_NOT_FOUND");
      }

      const freshActData = freshActSnap.data() || {};
      if (freshActData.used === true && freshActData.linkedToUid !== uid) {
        throw new Error("ACTIVATION_ALREADY_USED");
      }

      const areaIds = freshActData.areaIds || [];
      const productsList = freshActData.products || freshActData.assignedProductIds || [];
      const role = freshActData.role || "Medical Representative";
      if (!freshActData.country && !freshActData.countryId && !freshActData.marketId) {
        throw new Error("ACTIVATION_MARKET_REQUIRED");
      }

      const newUser: any = {
        id: uid,
        uid: uid,
        authUid: uid,
        email: verifiedEmail,
        name: freshActData.name || verifiedEmail.split("@")[0],
        firstName: freshActData.firstName || "",
        lastName: freshActData.lastName || "",
        role: role,
        managerEmail: freshActData.managerEmail || "",
        managerId: freshActData.managerId || "",
        region: freshActData.region || "National Scope",
        territory: freshActData.territory || "-",
        active: freshActData.active !== undefined ? freshActData.active : true,
        joinedDate: freshActData.createdAt ? freshActData.createdAt.split("T")[0] : now.split("T")[0],
        username: freshActData.username || verifiedEmail.split("@")[0],
        sidebarVisibility: freshActData.sidebarVisibility || ["dashboard", "physicians", "pharmacies", "products"],
        areaIds: areaIds,
        areaNames: freshActData.areaNames || [],
        products: productsList,
        territories: freshActData.territories || [],
        country: freshActData.country || "",
        countryId: freshActData.countryId || "",
        marketId: freshActData.marketId || freshActData.countryId || "",
        district: freshActData.district || "",
        city: freshActData.city || "",
        status: freshActData.status || "Active",
        employmentStatus: freshActData.employmentStatus || "Active",
        loginAllowed: freshActData.loginAllowed !== undefined ? freshActData.loginAllowed : true,
        isDeleted: false,
        securityScope: freshActData.securityScope || "Territory Only",
        primaryPromotionGroupId: freshActData.primaryPromotionGroupId || null,
        targetPromotionGroupIds: freshActData.targetPromotionGroupIds || null,
        assignmentSyncStatus: "COMPLETE",
        authLinked: true,
        firstLoginAt: now,
        createdAt: freshActData.createdAt || now,
        updatedAt: now
      };

      const cleanUser = removeUndefinedRecursively(newUser);
      createdUserPayload = cleanUser;

      transaction.set(userRef, cleanUser);

      // Update userActivationProfiles/{emailKey}
      transaction.set(actRef, removeUndefinedRecursively({
        used: true,
        linkedToUid: uid,
        activatedAt: now,
        updatedAt: now
      }), { merge: true });

      // Immutable Audit Log
      const auditLogId = `AL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const auditLogRef = adminDb.collection("auditLogs").doc(auditLogId);
      transaction.set(auditLogRef, removeUndefinedRecursively({
        id: auditLogId,
        timestamp: now.replace("T", " ").substring(0, 19) + " UTC",
        userId: uid,
        userName: cleanUser.name,
        userRole: cleanUser.role,
        action: "ActivationClaim",
        entityType: "Users",
        entityName: "Users",
        entityId: uid,
        details: `Claimed user activation profile for ${verifiedEmail}. Role: ${cleanUser.role}.`,
        createdAt: now,
        updatedAt: now
      }));

      // Territory Assignments
      if (areaIds.length > 0) {
        for (const areaId of areaIds) {
          const taId = `TA_${uid}_${areaId}`;
          const taRef = adminDb.collection("userTerritoryAssignments").doc(taId);
          transaction.set(taRef, removeUndefinedRecursively({
            assignmentId: taId,
            userId: uid,
            userRole: role,
            areaId: areaId,
            active: true,
            status: "Active",
            assignedBy: uid,
            assignedAt: now,
            updatedAt: now
          }));
        }
      }

      // Product Assignments
      if (productsList.length > 0) {
        for (const prodId of productsList) {
          const paId = `PA_${uid}_${prodId}`;
          const paRef = adminDb.collection("userProductAssignments").doc(paId);
          transaction.set(paRef, removeUndefinedRecursively({
            assignmentId: paId,
            userId: uid,
            userRole: role,
            productId: prodId,
            productName: prodId,
            primaryGroupId: freshActData.primaryPromotionGroupId || "",
            targetGroupIds: freshActData.targetPromotionGroupIds || [],
            assignmentType: role.toLowerCase().includes("sales") ? "sales" : "medical",
            active: true,
            status: "Active",
            assignedBy: uid,
            assignedAt: now,
            updatedAt: now
          }));
        }
      }
    });

    console.info(`[AuthActivationService] Successfully claimed activation profile for ${verifiedEmail} -> users/${uid}`);

    return {
      success: true,
      status: "SUCCESS",
      uid,
      email: verifiedEmail,
      role: createdUserPayload.role,
      profileCreated: true,
      activationClaimed: true,
      conflict: false,
      user: createdUserPayload
    };
  } catch (txnErr: any) {
    const errCode = txnErr.message || String(txnErr);
    if (errCode === "ACTIVATION_NOT_FOUND") {
      return {
        success: false,
        status: "ACTIVATION_NOT_FOUND",
        error: "No administrator-created activation profile was found for this email."
      };
    }
    if (errCode === "ACTIVATION_ALREADY_USED") {
      return {
        success: false,
        status: "ACTIVATION_ALREADY_USED",
        error: "This activation profile has already been used and linked to another account."
      };
    }

    console.error("[AuthActivationService] Transaction failed:", txnErr);
    return {
      success: false,
      status: "ERROR",
      error: `Activation transaction failed: ${txnErr.message || String(txnErr)}`
    };
  }
}
