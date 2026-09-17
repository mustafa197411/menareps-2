import type { User as FirebaseUser } from "firebase/auth";
export interface CanonicalSampleDistributionInput { id: string; physicianId: string; productId: string; sampleSkuId: string; quantity: number; notes?: string }
export async function distributeSample(user: Pick<FirebaseUser, "getIdToken">, input: CanonicalSampleDistributionInput, fetcher: typeof fetch = fetch) {
  const token = await user.getIdToken();
  const response = await fetcher("/api/samples/distribute", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true) throw new Error(payload.code || "SAMPLE_DISTRIBUTION_FAILED");
  return payload;
}
