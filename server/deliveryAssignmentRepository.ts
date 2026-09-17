import { getFirebaseAdminServices } from "./firebaseAdmin";

export interface DeliveryAssignmentUserRecord extends Record<string, any> {
  id: string;
}

export interface DeliveryAssignmentOrderRecord {
  id: string;
  data: Record<string, any>;
}

export interface DeliveryAssignmentTransactionContext {
  actor: DeliveryAssignmentUserRecord | null;
  officer: DeliveryAssignmentUserRecord | null;
  order: DeliveryAssignmentOrderRecord | null;
  write(patch: Record<string, any>, audit: Record<string, any>): void;
}

export interface DeliveryAssignmentRepository {
  getActor(uid: string): Promise<DeliveryAssignmentUserRecord | null>;
  listDeliveryOfficerCandidates(): Promise<DeliveryAssignmentUserRecord[]>;
  getUsersByIds(uids: string[]): Promise<DeliveryAssignmentUserRecord[]>;
  isAuthIdentityEnabled(uid: string): Promise<boolean>;
  runAssignmentTransaction<T>(
    actorUid: string,
    orderId: string,
    officerUid: string,
    operation: (context: DeliveryAssignmentTransactionContext) => Promise<T>,
  ): Promise<T>;
}

function record(snapshot: any): DeliveryAssignmentUserRecord | null {
  return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
}

export function createFirestoreDeliveryAssignmentRepository(): DeliveryAssignmentRepository {
  const { auth, db } = getFirebaseAdminServices();
  return {
    async getActor(uid) {
      return record(await db.collection("users").doc(uid).get());
    },
    async listDeliveryOfficerCandidates() {
      // Role normalization is applied by the service; this server-side read is never returned directly.
      const snapshot = await db.collection("users").get();
      return snapshot.docs.map((document: any) => ({ ...document.data(), id: document.id }));
    },
    async getUsersByIds(uids) {
      const unique = Array.from(new Set(uids.filter(Boolean)));
      if (unique.length === 0) return [];
      const snapshots = await Promise.all(unique.map((uid) => db.collection("users").doc(uid).get()));
      return snapshots.flatMap((snapshot) => {
        const value = record(snapshot);
        return value ? [value] : [];
      });
    },
    async isAuthIdentityEnabled(uid) {
      try {
        const identity = await auth.getUser(uid);
        return !identity.disabled;
      } catch {
        return false;
      }
    },
    async runAssignmentTransaction(actorUid, orderId, officerUid, operation) {
      const actorRef = db.collection("users").doc(actorUid);
      const orderRef = db.collection("orders").doc(orderId);
      const officerRef = db.collection("users").doc(officerUid);
      return db.runTransaction(async (transaction: any) => {
        const [actorSnapshot, orderSnapshot, officerSnapshot] = await Promise.all([
          transaction.get(actorRef),
          transaction.get(orderRef),
          transaction.get(officerRef),
        ]);
        const context: DeliveryAssignmentTransactionContext = {
          actor: record(actorSnapshot),
          officer: record(officerSnapshot),
          order: orderSnapshot.exists
            ? { id: orderSnapshot.id, data: { ...orderSnapshot.data(), id: orderSnapshot.id } }
            : null,
          write(patch, audit) {
            transaction.set(orderRef, patch, { merge: true });
            transaction.set(db.collection("auditLogs").doc(audit.id), audit);
          },
        };
        return operation(context);
      });
    },
  };
}
