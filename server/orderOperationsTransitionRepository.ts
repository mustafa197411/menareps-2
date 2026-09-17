import { getFirebaseAdminServices } from "./firebaseAdmin";
import { applyReservationEffectInTransaction } from "./inventoryReservationService";

export interface CurrentOrderRecord {
  id: string;
  version: string;
  data: Record<string, any>;
}

export interface OrderOperationsTransactionContext {
  order: CurrentOrderRecord | null;
  getPharmacy(pharmacyId: string): Promise<Record<string, any> | null>;
  releaseVersion2Reservation?(order: Record<string, any>, actorUid: string, reason?: string): Promise<void>;
  write(patch: Record<string, any>, audit: Record<string, any>): void;
}

export interface OrderOperationsTransitionRepository {
  runTransaction<T>(
    orderId: string,
    operation: (context: OrderOperationsTransactionContext) => Promise<T>,
  ): Promise<T>;
}

function versionOf(snapshot: any): string {
  const timestamp = snapshot.updateTime;
  if (!timestamp) return "";
  return `${timestamp.seconds}:${timestamp.nanoseconds}`;
}

export function createFirestoreOrderOperationsTransitionRepository(): OrderOperationsTransitionRepository {
  const db = getFirebaseAdminServices().db;
  return {
    async runTransaction(orderId, operation) {
      const orderRef = db.collection("orders").doc(orderId);
      return db.runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(orderRef);
        const context: OrderOperationsTransactionContext = {
          order: snapshot.exists
            ? { id: snapshot.id, version: versionOf(snapshot), data: { ...snapshot.data(), id: snapshot.id } }
            : null,
          async getPharmacy(pharmacyId) {
            const pharmacySnapshot = await transaction.get(db.collection("pharmacies").doc(pharmacyId));
            return pharmacySnapshot.exists ? { ...pharmacySnapshot.data(), id: pharmacySnapshot.id } : null;
          },
          async releaseVersion2Reservation(order, actorUid, reason) {
            await applyReservationEffectInTransaction(db, transaction, order, actorUid, "RELEASE", reason);
          },
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
