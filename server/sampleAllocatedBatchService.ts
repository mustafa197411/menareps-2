import { getFirebaseAdminServices } from "./firebaseAdmin";

export interface AllocatedBatchResult {
  success: boolean;
  batches?: Array<Record<string, unknown>>;
  code?: string;
}

export interface AllocatedBatchRepository {
  getUser(uid: string): Promise<Record<string, any> | null>;
  getAllocation(id: string): Promise<Record<string, any> | null>;
  getBatch(id: string): Promise<Record<string, any> | null>;
}

function firestoreRepository(): AllocatedBatchRepository {
  const { db } = getFirebaseAdminServices();
  const read = async (collection: string, id: string) => {
    const snapshot = await db.collection(collection).doc(id).get();
    return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
  };
  return {
    getUser: uid => read("users", uid),
    getAllocation: id => read("sampleAllocations", id),
    getBatch: id => read("sampleBatches", id),
  };
}

export function parseAllocatedBatchRequest(input: unknown): { allocationIds: string[] } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== "allocationIds") || !Array.isArray(body.allocationIds)) return null;
  const allocationIds = [...new Set(body.allocationIds.filter((id): id is string => typeof id === "string").map(id => id.trim()))];
  return allocationIds.length > 0 && allocationIds.length <= 30 && allocationIds.every(id => id.length <= 128) ? { allocationIds } : null;
}

export async function resolveAllocatedBatchesForRepresentative(actorUid: string, allocationIds: string[], repository = firestoreRepository()): Promise<AllocatedBatchResult> {
  const actorData = await repository.getUser(actorUid);
  if (!actorData || actorData.role !== "Medical Representative" || actorData.active === false || actorData.loginAllowed !== true || actorData.isDeleted === true) {
    return { success: false, code: "ACTOR_NOT_AUTHORIZED" };
  }
  const allocations = await Promise.all(allocationIds.map(id => repository.getAllocation(id)));
  if (allocations.some(allocation => !allocation || allocation.repId !== actorUid || allocation.status !== "ACTIVE")) {
    return { success: false, code: "ALLOCATION_NOT_AUTHORIZED" };
  }
  if (allocations.some(allocation => !String(allocation?.batchId || "").trim())) return { success: false, code: "ALLOCATION_BATCH_MISSING" };
  const batchIds = [...new Set(allocations.map(allocation => String(allocation!.batchId).trim()))];
  const batches = await Promise.all(batchIds.map(id => repository.getBatch(id)));
  if (batches.some(batch => !batch)) return { success: false, code: "BATCH_NOT_FOUND" };
  return { success: true, batches: batches as Array<Record<string, unknown>> };
}
