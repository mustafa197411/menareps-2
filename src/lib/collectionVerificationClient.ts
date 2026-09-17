import type { User } from "firebase/auth";
import type { CollectionVerificationRequest, CollectionVerificationResponse } from "../features/ar/arTypes";
export async function verifyCollection(user: Pick<User, "getIdToken">, input: CollectionVerificationRequest, fetcher: typeof fetch = fetch): Promise<CollectionVerificationResponse> {
  const token = await user.getIdToken();
  const response = await fetcher("/api/collections/verify", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ collectionId: input.collectionId, expectedRevision: input.expectedRevision }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.code || "COLLECTION_VERIFICATION_FAILED");
  return result;
}
