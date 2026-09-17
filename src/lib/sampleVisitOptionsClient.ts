import type { User as FirebaseUser } from "firebase/auth";

export interface SampleVisitOption { sampleSkuId: string; productId: string; name: string; descriptor?: string; availableQuantity: number; batches: Array<{ batchId: string; batchNumber: string; expiryDate: string; availableQuantity: number }> }

export async function fetchSampleVisitOptions(user: Pick<FirebaseUser, "getIdToken">, physicianId: string, fetcher: typeof fetch = fetch): Promise<SampleVisitOption[]> {
  const token = await user.getIdToken();
  const response = await fetcher("/api/samples/visit-options", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ physicianId }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true || !Array.isArray(payload.options)) throw new Error(payload.code || "SAMPLE_OPTIONS_LOAD_FAILED");
  return payload.options;
}
