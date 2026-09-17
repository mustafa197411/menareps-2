import { collectionSubmissionId } from "./collectionService";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { SubmittedCollection } from "../src/features/ar/arTypes";

/** Inject a transaction: caller owns commit, retry, authorization and complete receivable reads. */
export async function createSubmittedCollection(db: Firestore, tx: Transaction, command: SubmittedCollection) {
  if (!command.id || command.id.includes("/") || command.status !== "Submitted" || command.revision !== 1) throw new Error("INVALID_COLLECTION_COMMAND");
  const id = collectionSubmissionId(command.actorUid, command.requestKey);
  if (command.id !== id) throw new Error("INVALID_COLLECTION_COMMAND");
  const ref = db.collection("paymentCollections").doc(id);
  const snapshot = await tx.get(ref);
  if (snapshot.exists) {
    const existing = snapshot.data()!;
    if (existing.payloadHash !== command.payloadHash || existing.actorUid !== command.actorUid || existing.requestKey !== command.requestKey) throw new Error("COLLECTION_IDEMPOTENCY_CONFLICT");
    return { created: false, collection: existing };
  }
  tx.create(ref, command);
  tx.create(db.collection("auditLogs").doc(`SUBMITTED_${command.id}`), {
    action: "COLLECTION_SUBMITTED", collectionId: command.id, actorUid: command.actorUid, createdAt: command.createdAt, payloadHash: command.payloadHash,
  });
  return { created: true, collection: command };
}
