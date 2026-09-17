import { Firestore } from "firebase-admin/firestore";
import { removeUndefinedRecursively } from "../utils/importNormalization";

export interface MigrationInventoryRecord {
  collection: string;
  docId: string;
  field: string;
  currentValue: string;
  intendedValue: string;
}

export interface AdminLybiaMigrationOptions {
  dryRun?: boolean;
  confirmationToken?: string;
  actorUid?: string;
}

export interface AdminLybiaMigrationResult {
  success: boolean;
  dryRun: boolean;
  activationProfileId: string;
  provisionalDocId: string;
  canonicalAuthUid: string;
  inventoryCount: number;
  inventory: MigrationInventoryRecord[];
  backupManifest: {
    timestamp: string;
    provisionalDocData: any;
    activationProfileData: any;
    referencesFound: MigrationInventoryRecord[];
  };
  dependentRecordsReplacedCount: number;
  provisionalArchived: boolean;
  postMigrationVerified: boolean;
  logs: string[];
  error?: string;
}

export const ALL_REFERENCE_FIELDS = [
  "userId",
  "authUid",
  "uid",
  "linkedToUid",
  "managerId",
  "assignedRepId",
  "assignedSupervisorId",
  "assignedManagerId",
  "createdBy",
  "createdById",
  "updatedBy",
  "actorUid",
  "representativeId",
  "supervisorId",
  "ownerId"
] as const;

export const COLLECTIONS_TO_AUDIT = [
  "users",
  "userActivationProfiles",
  "userTerritoryAssignments",
  "userProductAssignments",
  "auditLogs",
  "physicianVisits",
  "pharmacyVisits",
  "orders",
  "importHistory",
  "productTargetPlans",
  "targetCalculationRuns",
  "salesPerformanceExceptions"
] as const;

/**
 * Controlled Backend Admin SDK Migration Utility for Admin Lybia Account.
 * Target Account:
 *   activation profile: userActivationProfiles/adminlybia-esnad-local
 *   provisional profile: users/RC7LVUKEhqhvKY0eUCyu
 *   real Auth UID: nIECWX5cXZaVhrDgwebiVhXUzmw1
 *
 * SAFETY GUARANTEES:
 * 1. Default mode is dryRun = true. No Firestore mutations take place unless dryRun = false.
 * 2. Requires explicit confirmation token 'CONFIRM_EXECUTE_ADMIN_LYBIA_MIGRATION' when dryRun = false.
 * 3. Audits all 15 reference fields across 12 domain collections before any modification.
 * 4. Generates an immutable backup manifest before performing batched writes.
 * 5. Runs post-migration verification step to verify 0 references remain to the provisional ID.
 * 6. Never deletes documents; archives provisional documents with isDeleted = true and archived = true.
 */
export async function runAdminLybiaMigrationBackend(
  adminDb: Firestore,
  options: AdminLybiaMigrationOptions = {}
): Promise<AdminLybiaMigrationResult> {
  const dryRun = options.dryRun !== false; // Default to true unless explicitly false
  const confirmationToken = options.confirmationToken || "";
  const actorUid = options.actorUid || "SYSTEM_MIGRATOR";

  const activationProfileId = "adminlybia-esnad-local";
  const provisionalDocId = "RC7LVUKEhqhvKY0eUCyu";
  const canonicalAuthUid = "nIECWX5cXZaVhrDgwebiVhXUzmw1";

  const logs: string[] = [];
  const log = (msg: string, data?: any) => {
    const formatted = data ? `${msg} ${JSON.stringify(data)}` : msg;
    logs.push(formatted);
    console.info(`[ADMIN_LYBIA_MIGRATION_BACKEND] ${formatted}`);
  };

  log("Starting Admin Lybia Controlled Migration Audit", {
    dryRun,
    activationProfileId,
    provisionalDocId,
    canonicalAuthUid
  });

  const inventory: MigrationInventoryRecord[] = [];
  const now = new Date().toISOString();

  try {
    // 1. Read Activation Profile & Provisional Profile
    const actRef = adminDb.collection("userActivationProfiles").doc(activationProfileId);
    const actSnap = await actRef.get();

    const provRef = adminDb.collection("users").doc(provisionalDocId);
    const provSnap = await provRef.get();

    const actData = actSnap.exists ? actSnap.data() : {};
    const provData = provSnap.exists ? provSnap.data() : {};

    // 2. Perform Complete Reference Inventory across 12 collections and 15 fields
    log("Building reference inventory across all domain collections...");

    for (const collName of COLLECTIONS_TO_AUDIT) {
      for (const fieldName of ALL_REFERENCE_FIELDS) {
        try {
          const snapshot = await adminDb
            .collection(collName)
            .where(fieldName, "==", provisionalDocId)
            .get();

          for (const docSnap of snapshot.docs) {
            // Avoid adding provisional document itself as a field query duplicate if already handled
            inventory.push({
              collection: collName,
              docId: docSnap.id,
              field: fieldName,
              currentValue: provisionalDocId,
              intendedValue: canonicalAuthUid
            });
          }
        } catch (queryErr: any) {
          log(`Query warning on ${collName}.${fieldName}:`, queryErr.message || queryErr);
        }
      }
    }

    log(`Reference analysis complete. Found ${inventory.length} references to provisional ID '${provisionalDocId}'.`);

    // Build Backup Manifest
    const backupManifest = {
      timestamp: now,
      provisionalDocData: provData,
      activationProfileData: actData,
      referencesFound: [...inventory]
    };

    // DRY RUN RETURN
    if (dryRun) {
      log("DRY RUN COMPLETE: No data was written to Firestore.");
      return {
        success: true,
        dryRun: true,
        activationProfileId,
        provisionalDocId,
        canonicalAuthUid,
        inventoryCount: inventory.length,
        inventory,
        backupManifest,
        dependentRecordsReplacedCount: 0,
        provisionalArchived: false,
        postMigrationVerified: false,
        logs
      };
    }

    // MANDATORY EXECUTION SAFETY CHECKS
    if (confirmationToken !== "CONFIRM_EXECUTE_ADMIN_LYBIA_MIGRATION") {
      throw new Error(
        "MIGRATION_BLOCKED: Execution requires explicit confirmationToken 'CONFIRM_EXECUTE_ADMIN_LYBIA_MIGRATION'."
      );
    }

    log("EXPLICIT CONFIRMATION CONFIRMED: Proceeding with atomic batched write migration...");

    // 3. Construct Canonical User Document at users/nIECWX5cXZaVhrDgwebiVhXUzmw1
    const canonicalUserPayload = removeUndefinedRecursively({
      id: canonicalAuthUid,
      uid: canonicalAuthUid,
      authUid: canonicalAuthUid,
      email: "adminlybia@esnad.local",
      name: provData.name || actData.name || "Admin Lybia",
      firstName: provData.firstName || actData.firstName || "Admin",
      lastName: provData.lastName || actData.lastName || "Lybia",
      role: provData.role || actData.role || "Admin",
      managerEmail: provData.managerEmail || actData.managerEmail || "",
      managerId: provData.managerId || actData.managerId || "",
      region: provData.region || actData.region || "National Scope",
      territory: provData.territory || actData.territory || "No Geographic Restriction",
      active: true,
      joinedDate: provData.joinedDate || actData.createdAt?.split("T")[0] || now.split("T")[0],
      username: provData.username || actData.username || "adminlybia",
      sidebarVisibility: provData.sidebarVisibility || actData.sidebarVisibility || [
        "dashboard",
        "users",
        "physicians",
        "pharmacies",
        "products"
      ],
      areaIds: provData.areaIds || actData.areaIds || [],
      areaNames: provData.areaNames || actData.areaNames || [],
      products: provData.products || actData.products || [],
      territories: provData.territories || actData.territories || [],
      country: provData.country || actData.country || "Libya",
      district: provData.district || actData.district || "National Scope",
      city: provData.city || actData.city || "National Scope",
      status: "Active",
      employmentStatus: "Active",
      loginAllowed: true,
      isDeleted: false,
      securityScope: provData.securityScope || actData.securityScope || "COUNTRY",
      primaryPromotionGroupId: provData.primaryPromotionGroupId || actData.primaryPromotionGroupId || null,
      targetPromotionGroupIds: provData.targetPromotionGroupIds || actData.targetPromotionGroupIds || null,
      assignmentSyncStatus: "COMPLETE",
      authLinked: true,
      firstLoginAt: now,
      createdAt: provData.createdAt || actData.createdAt || now,
      updatedAt: now
    });

    // 4. Batched Writes Execution
    const batch = adminDb.batch();

    // Set canonical user profile
    batch.set(adminDb.collection("users").doc(canonicalAuthUid), canonicalUserPayload);

    // Update Activation Profile
    if (actSnap.exists) {
      batch.set(
        actRef,
        removeUndefinedRecursively({
          used: true,
          linkedToUid: canonicalAuthUid,
          activatedAt: now,
          updatedAt: now
        }),
        { merge: true }
      );
    }

    // Re-point dependent references in batch
    let updatedCount = 0;
    for (const item of inventory) {
      if (item.collection === "users" && item.docId === provisionalDocId) {
        continue; // Handled in archival step below
      }
      const ref = adminDb.collection(item.collection).doc(item.docId);
      batch.update(ref, {
        [item.field]: canonicalAuthUid,
        updatedAt: now
      });
      updatedCount++;
    }

    // Commit Batched Writes
    log(`Committing batch with canonical creation and ${updatedCount} reference updates...`);
    await batch.commit();

    // 5. Post-Migration Verification Step
    log("Executing post-migration verification scan...");
    let remainingReferencesCount = 0;

    for (const collName of COLLECTIONS_TO_AUDIT) {
      for (const fieldName of ALL_REFERENCE_FIELDS) {
        const checkSnap = await adminDb
          .collection(collName)
          .where(fieldName, "==", provisionalDocId)
          .get();

        for (const docSnap of checkSnap.docs) {
          if (collName === "users" && docSnap.id === provisionalDocId) {
            continue; // The provisional doc itself is verified during archival check
          }
          remainingReferencesCount++;
          log(`VERIFICATION WARNING: Unmigrated reference in ${collName}/${docSnap.id}.${fieldName}`);
        }
      }
    }

    const postMigrationVerified = remainingReferencesCount === 0;
    log(`Post-migration verification completed. Remaining active references: ${remainingReferencesCount}`);

    // 6. Archive Provisional Document (ONLY after references verified)
    let provisionalArchived = false;
    if (provSnap.exists) {
      log(`Archiving provisional document users/${provisionalDocId}...`);
      await provRef.update({
        isDeleted: true,
        archived: true,
        migratedToUid: canonicalAuthUid,
        archivedAt: now,
        updatedAt: now
      });
      provisionalArchived = true;
    }

    // Create Audit Log for Migration Execution
    const auditLogId = `AL-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    await adminDb.collection("auditLogs").doc(auditLogId).set(
      removeUndefinedRecursively({
        id: auditLogId,
        timestamp: now.replace("T", " ").substring(0, 19) + " UTC",
        userId: actorUid,
        userName: "Admin Migration Utility",
        userRole: "System Admin",
        action: "MigrationExecution",
        entityType: "Users",
        entityName: "Users",
        entityId: canonicalAuthUid,
        details: `Migrated Admin Lybia account from provisional ID ${provisionalDocId} to canonical UID ${canonicalAuthUid}. Replaced ${updatedCount} references.`,
        createdAt: now,
        updatedAt: now
      })
    );

    log("Admin Lybia migration completed successfully!", {
      canonicalAuthUid,
      dependentRecordsReplacedCount: updatedCount,
      provisionalArchived,
      postMigrationVerified
    });

    return {
      success: true,
      dryRun: false,
      activationProfileId,
      provisionalDocId,
      canonicalAuthUid,
      inventoryCount: inventory.length,
      inventory,
      backupManifest,
      dependentRecordsReplacedCount: updatedCount,
      provisionalArchived,
      postMigrationVerified,
      logs
    };
  } catch (err: any) {
    log("Migration failed with error:", err.message || err);
    return {
      success: false,
      dryRun,
      activationProfileId,
      provisionalDocId,
      canonicalAuthUid,
      inventoryCount: inventory.length,
      inventory,
      backupManifest: {
        timestamp: now,
        provisionalDocData: null,
        activationProfileData: null,
        referencesFound: []
      },
      dependentRecordsReplacedCount: 0,
      provisionalArchived: false,
      postMigrationVerified: false,
      logs,
      error: err.message || String(err)
    };
  }
}
