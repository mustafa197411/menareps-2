import type { User } from "firebase/auth";
import type { CollectionReversalRequest, CollectionReversalResponse, CollectionReversalStatus } from "../features/ar/arTypes";
export async function reverseCollection(user: Pick<User, "getIdToken">, input: CollectionReversalRequest, fetcher: typeof fetch = fetch): Promise<CollectionReversalResponse> {
  const token = await user.getIdToken();
  const response = await fetcher("/api/collections/reverse", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ collectionId: input.collectionId, expectedRevision: input.expectedRevision, reason: input.reason }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.code || "COLLECTION_REVERSAL_FAILED");
  return result;
}
export async function fetchCollectionReversal(user: Pick<User, "getIdToken">, collectionId: string, expectedRevision: number, fetcher: typeof fetch = fetch): Promise<CollectionReversalStatus> {
  const token = await user.getIdToken();
  const query = new URLSearchParams({ collectionId, expectedRevision: String(expectedRevision) });
  const response = await fetcher(`/api/collections/reverse?${query}`, { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.code || "COLLECTION_REVERSAL_FAILED");
  return result;
}
