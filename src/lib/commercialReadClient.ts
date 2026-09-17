import type { User as FirebaseUser } from "firebase/auth";
import type { CommercialReadRequest } from "../../server/commercialReadService";

export async function fetchScopedCommercialRead(user: Pick<FirebaseUser, "getIdToken">, request: CommercialReadRequest, fetchImplementation: typeof fetch = fetch): Promise<any> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/commercial/scoped-query", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(request) });
  const payload = await response.json();
  if (!response.ok || !payload?.authorized) { const error = new Error("Unable to load authorized commercial records") as Error & { code?: string }; error.code = payload?.code || `HTTP_${response.status}`; throw error; }
  return payload;
}
