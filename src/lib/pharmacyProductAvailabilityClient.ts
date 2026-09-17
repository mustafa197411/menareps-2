import type { User as FirebaseUser } from "firebase/auth";
import { auth } from "./firebase";
import type { ProductAvailability } from "../features/pharmacyVisit/types/productAvailability";
import { unresolvedAvailability } from "../features/pharmacyVisit/types/productAvailability";

export async function readPharmacyProductAvailability(
  pharmacyId: string,
  productIds: string[],
  fetcher: typeof fetch = fetch,
  tokenProvider: Pick<FirebaseUser, "getIdToken"> | null = auth.currentUser,
): Promise<ProductAvailability[]> {
  if (!pharmacyId) return productIds.map(id => unresolvedAvailability(id, "PHARMACY_CONTEXT_REQUIRED", "UNRESOLVED_CONTEXT"));
  if (!tokenProvider) return productIds.map(id => unresolvedAvailability(id, "AVAILABILITY_AUTH_REQUIRED"));
  try {
    const response = await fetcher("/api/pharmacy-visits/product-availability", {
      method: "POST",
      headers: { Authorization: `Bearer ${await tokenProvider.getIdToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pharmacyId, productIds }),
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => null) as { authorized?: boolean; availability?: ProductAvailability[]; code?: string } | null;
    if (!response.ok || !payload?.authorized || !Array.isArray(payload.availability)) throw new Error(payload?.code || "AVAILABILITY_REQUEST_FAILED");
    const byId = new Map(payload.availability.map(item => [item.productId, item]));
    return productIds.map(id => byId.get(id) || unresolvedAvailability(id, "AVAILABILITY_RESPONSE_PRODUCT_MISSING"));
  } catch (error) {
    const code = error instanceof Error && error.name === "TimeoutError" ? "AVAILABILITY_REQUEST_TIMEOUT" : error instanceof Error ? error.message : "AVAILABILITY_REQUEST_FAILED";
    return productIds.map(id => unresolvedAvailability(id, code));
  }
}
