import type { User } from "firebase/auth";
import type { CollectionSubmissionInput } from "../../server/collectionSubmissionService";
export async function submitCollection(user: Pick<User, "getIdToken">, input: CollectionSubmissionInput, fetcher: typeof fetch = fetch): Promise<{ success: true; created: boolean; collectionId: string }> {
  const token = await user.getIdToken();
  const response = await fetcher("/api/collections/submit", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.code || "COLLECTION_SUBMISSION_FAILED");
  return result;
}
