import type { User as FirebaseUser } from "firebase/auth";
export interface StandaloneSampleRequestCommand { idempotencyKey: string; physicianId?: string; sampleSkuId: string; quantity: number; reason: string; expectedDeliveryDate?: string; urgent: boolean; }
export async function createAuthorizedSampleRequest(user: Pick<FirebaseUser, "getIdToken">, input: StandaloneSampleRequestCommand, fetcher: typeof fetch = fetch) {
  const token = await user.getIdToken();
  const response = await fetcher("/api/samples/requests", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true) throw new Error(payload.code || "SAMPLE_REQUEST_CREATE_FAILED");
  return payload;
}
