import type { User } from "firebase/auth";
import { auth } from "./firebase";

export async function createOrderFromCompletedPharmacyVisit(visitId: string, fetcher: typeof fetch = fetch, tokenProvider: Pick<User, "getIdToken"> | null = auth.currentUser) {
  const user = tokenProvider;
  if (!user) throw new Error("ORDER_AUTHENTICATED_ACTOR_REQUIRED");
  const token = await user.getIdToken();
  const response = await fetcher("/api/pharmacy-orders/create", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ visitId }) });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.code || "ORDER_CREATE_FAILED");
  return payload as { success: true; orderId: string; displayNumber: string; alreadyCreated: boolean };
}
