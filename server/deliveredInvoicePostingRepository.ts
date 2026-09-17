import type { CertificationEvidence } from "../src/features/ar/arTypes";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdminServices } from "./firebaseAdmin";

export interface DeliveredInvoiceRecord extends Record<string, any> { id: string }

export interface DeliveredInvoiceTransactionContext {
  actor: DeliveredInvoiceRecord | null;
  order: DeliveredInvoiceRecord | null;
  existingLedger: DeliveredInvoiceRecord | null;
  profile: DeliveredInvoiceRecord | null;
  pharmacy: DeliveredInvoiceRecord | null;
  market: DeliveredInvoiceRecord | null;
  ledgerId: string;
  certificationEvidence?: CertificationEvidence;
  create(ledger: Record<string, any>, profile: Record<string, any>): void;
}

export interface DeliveredInvoicePostingRepository {
  runTransaction<T>(
    actorUid: string,
    orderId: string,
    operation: (context: DeliveredInvoiceTransactionContext) => T | Promise<T>,
  ): Promise<T>;
}

function value(snapshot: any): DeliveredInvoiceRecord | null {
  return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
}

export function createFirestoreDeliveredInvoicePostingRepository(options: { db?: Firestore; transaction?: Transaction } = {}): DeliveredInvoicePostingRepository {
  const db = options.db || getFirebaseAdminServices().db;
  return {
    async runTransaction(actorUid, orderId, operation) {
      const operationInTransaction = async (transaction: Transaction) => {
        const actorRef = db.collection("users").doc(actorUid);
        const orderRef = db.collection("orders").doc(orderId);
        const [actorSnapshot, orderSnapshot] = await Promise.all([
          transaction.get(actorRef), transaction.get(orderRef),
        ]);
        const order = value(orderSnapshot);
        const invoiceId = String(order?.invoiceNumber || order?.commercialInvoiceNumber || order?.invoiceId || `INV-${order?.displayNumber || orderId}`);
        const safePart = (input: string) => input.replace(/[^a-zA-Z0-9_-]/g, "_");
        const ledgerId = `LEDGER_INVOICE_${safePart(orderId)}_${safePart(invoiceId)}`;
        const ledgerRef = db.collection("customerLedgerEntries").doc(ledgerId);
        const ledgerSnapshot = await transaction.get(ledgerRef);
        const primary = String(order?.pharmacyId || "").trim();
        const legacy = String(order?.pharmacy || "").trim();
        if (primary && legacy && primary !== legacy) throw new Error("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED");
        const pharmacyId = primary || legacy;
        if (!pharmacyId || pharmacyId.includes("/")) throw new Error("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED");
        const profileRef = db.collection("customerFinancialProfiles").doc(pharmacyId || "__invalid__");
        const pharmacyRef = db.collection("pharmacies").doc(pharmacyId || "__invalid__");
        const marketId = String(order?.marketId || "").trim();
        const marketRef = db.collection("marketSettings").doc(marketId || "__invalid__");
        const [profileSnapshot, pharmacySnapshot, marketSnapshot] = await Promise.all([
          pharmacyId ? transaction.get(profileRef) : Promise.resolve({ exists: false }),
          pharmacyId ? transaction.get(pharmacyRef) : Promise.resolve({ exists: false }),
          marketId ? transaction.get(marketRef) : Promise.resolve({ exists: false }),
        ]);
        let certificationEvidence: CertificationEvidence | undefined;
        if (!profileSnapshot.exists && !ledgerSnapshot.exists) {
          const specs = [
            ["ledger", "customerLedgerEntries", "pharmacyId", 1],
            ["collections", "paymentCollections", "pharmacyId", 1],
            ["payments", "payments", "pharmacyId", 1],
            ["visits", "pharmacyVisits", "pharmacyId", 1],
            ["orders", "orders", "pharmacyId", 2],
            ["legacyOrders", "orders", "pharmacy", 2],
          ] as const;
          try {
            const evidence = await Promise.all(specs.map(async ([key, collection, field, limit]) => {
              const snapshot = await transaction.get(db.collection(collection).where(field, "==", pharmacyId).limit(limit));
              if (!Array.isArray(snapshot.docs) || snapshot.docs.length > limit) throw new Error("INCOMPLETE_EVIDENCE");
              return [key, snapshot.docs.map(doc => doc.id)] as const;
            }));
            certificationEvidence = Object.fromEntries(evidence) as unknown as CertificationEvidence;
          } catch {
            throw new Error("FINANCIAL_PROJECTION_INITIALIZATION_REQUIRED");
          }
        }
        return operation({
          actor: value(actorSnapshot), order, existingLedger: value(ledgerSnapshot), ledgerId, certificationEvidence,
          profile: value(profileSnapshot), pharmacy: value(pharmacySnapshot), market: value(marketSnapshot),
          create(ledger, profile) {
            transaction.create(ledgerRef, ledger);
            transaction.set(profileRef, profile, { merge: true });
          },
        });
      };
      return options.transaction ? operationInTransaction(options.transaction) : db.runTransaction(operationInTransaction);
    },
  };
}
