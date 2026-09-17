import { auth } from "./firebase";
import type { PharmacyVisitDraft } from "../features/pharmacyVisit/types/domain";

export interface PharmacyVisitCompletionResponse {
  success: boolean;
  code?: string;
  visitId?: string;
  displayNumber?: string;
  alreadyCompleted?: boolean;
  orderId?: string;
  orderDisplayNumber?: string;
  authoritativeTotals?: { grossSubtotal: number; totalDiscount: number; netSubtotal: number; currencyCode: string };
  appliedOfferIds?: string[];
  references?: { offerId?: string; productId?: string };
}

export async function completePharmacyVisitAuthoritatively(
  draft: PharmacyVisitDraft,
  finalRemarks?: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<PharmacyVisitCompletionResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error("AUTHENTICATION_REQUIRED");
  const response = await fetchImplementation("/api/pharmacy-visits/complete", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ draft, ...(finalRemarks?.trim() ? { finalRemarks: finalRemarks.trim() } : {}) }),
  });
  const payload = await response.json() as PharmacyVisitCompletionResponse;
  if (!response.ok || !payload.success) throw new Error(payload.code || "PHARMACY_VISIT_COMPLETION_FAILED");
  return payload;
}
