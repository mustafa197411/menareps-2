import type { User as FirebaseUser } from "firebase/auth";
import type { ProductAnalyticsOrder } from "../../server/productAnalyticsReadService";
export async function fetchScopedProductAnalytics(user: Pick<FirebaseUser, "getIdToken">, fetchImplementation: typeof fetch = fetch): Promise<{ authorized: boolean; code?: string; orders: ProductAnalyticsOrder[] }> {
  const token = await user.getIdToken(); const response = await fetchImplementation("/api/analytics/products/scoped-query", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" }); const payload = await response.json();
  if (!response.ok || !payload?.authorized || !Array.isArray(payload.orders)) { const error = new Error("Unable to load product analytics") as Error & { code?: string }; error.code = payload?.code || `HTTP_${response.status}`; throw error; } return payload;
}
