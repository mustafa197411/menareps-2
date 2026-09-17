import { getFirebaseAdminServices } from "./firebaseAdmin";
import { FieldPath, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { assertHierarchyContinuationCapacity, OrganizationalHierarchyError,
  type OrganizationalHierarchyRepository, type OrganizationalUser, type ReportingDescendantRepository } from "./organizationalHierarchyService";

/** Preserve the established document identity contract before projection. */
export function decodeCanonicalUserDocument(id: string, data: Record<string, unknown>): OrganizationalUser {
  if (!id || id !== id.trim() || id.includes("/") || (data.id !== undefined && data.id !== id)) {
    throw new OrganizationalHierarchyError("HIERARCHY_MALFORMED", 409, "User identity does not match document identity");
  }
  return { ...data, id } as OrganizationalUser;
}

export function createFirestoreOrganizationalHierarchyRepository(
  db: Firestore = getFirebaseAdminServices().db,
): OrganizationalHierarchyRepository & ReportingDescendantRepository {
  return {
    async getUser(uid) {
      const snapshot = await db.collection("users").doc(uid).get();
      return snapshot.exists ? decodeCanonicalUserDocument(snapshot.id, snapshot.data()!) : null;
    },
    async getDirectReports(managerUid) {
      const snapshot = await db.collection("users").where("managerId", "==", managerUid).get();
      return snapshot.docs.map((document) => decodeCanonicalUserDocument(document.id, document.data()));
    },
    async getDirectReportsPage(managerUid, afterDocumentId, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new OrganizationalHierarchyError("HIERARCHY_DISCOVERY_REQUEST_INVALID", 400, "Invalid direct-report query limit");
      }
      let query = db.collection("users").where("managerId", "==", managerUid).orderBy(FieldPath.documentId(), "asc");
      if (afterDocumentId !== undefined) query = query.startAfter(afterDocumentId);
      const snapshot = await query.limit(limit).get();
      return snapshot.docs.map(document => {
        const data = document.data();
        if (data.id !== undefined && data.id !== document.id) {
          throw new OrganizationalHierarchyError("HIERARCHY_MALFORMED", 409, "User identity does not match document identity");
        }
        return decodeCanonicalUserDocument(document.id, data);
      });
    },
    async getContinuation(token) {
      const snapshot = await db.collection("organizationalHierarchyContinuations").doc(token).get();
      return snapshot.exists ? { token, document: snapshot.data(), revision: snapshot.updateTime } : null;
    },
    async advanceContinuation(current, replacement) {
      if (!current && !replacement) return;
      if (replacement) assertHierarchyContinuationCapacity(replacement.document);
      const batch = db.batch();
      if (current) {
        // A stale reader cannot delete a consumed token or create a successor.
        batch.delete(db.collection("organizationalHierarchyContinuations").doc(current.token), {
          lastUpdateTime: current.revision as Timestamp,
        });
      }
      if (replacement) {
        batch.create(db.collection("organizationalHierarchyContinuations").doc(replacement.token), replacement.document);
      }
      try { await batch.commit(); } catch (error) {
        const code = (error as { code?: number }).code;
        if (code === 5 || code === 6 || code === 9 || code === 10) {
          throw new OrganizationalHierarchyError("HIERARCHY_CONTINUATION_CONFLICT", 409, "Continuation was consumed or changed concurrently");
        }
        throw error;
      }
    },
    async getAllUsers() {
      const snapshot = await db.collection("users").get();
      return snapshot.docs.map((document) => decodeCanonicalUserDocument(document.id, document.data()));
    },
    async getRolePermissions(role) {
      const snapshot = await db.collection("rolePermissions").doc(role).get();
      return snapshot.exists ? (snapshot.data() || null) : null;
    },
    async getAccessGovernance(role) {
      const snapshot = await db.collection("accessGovernance").doc(role).get();
      return snapshot.exists ? (snapshot.data() || null) : null;
    },
  };
}
