import { auth } from "../../../lib/firebase";
import { validateCanonicalOfferDefinition } from "../../offers/offerValidation";
import type { CanonicalOfferDefinition } from "../../offers/types";

export class PharmacyOfferReadError extends Error { constructor(public readonly code: string) { super(code); this.name = "PharmacyOfferReadError"; } }
export async function fetchLivePharmacyOffers(request: { pharmacyId: string; productIds: string[]; paidLines: Array<{ lineId: string; productId: string; quantity: number }>; selectedOfferIds: string[] }): Promise<{ offers: CanonicalOfferDefinition[]; unavailableOfferIds: string[]; selectedCombinationAvailable: boolean }> {
  const user = auth.currentUser;
  if (!user) throw new PharmacyOfferReadError("OFFER_AUTHENTICATION_REQUIRED");
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/pharmacy-offers/scoped-query", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(request) });
    const payload = await response.json() as { authorized?: boolean; complete?: boolean; code?: string; offers?: unknown[]; unavailableOfferIds?: unknown; selectedCombinationAvailable?: unknown };
    if (!response.ok || payload.authorized !== true || payload.complete !== true || !Array.isArray(payload.offers)) throw new PharmacyOfferReadError(payload.code || "OFFER_READ_FAILED");
    const offers = payload.offers.map(value => {
      const parsed = validateCanonicalOfferDefinition(value);
      if (!parsed.valid || parsed.value.lifecycleStatus !== "ACTIVE") throw new PharmacyOfferReadError("OFFER_READ_FAILED");
      return parsed.value;
    });
    if (new Set(offers.map(offer => offer.id)).size !== offers.length || !Array.isArray(payload.unavailableOfferIds) || payload.unavailableOfferIds.some(id => typeof id !== "string") || typeof payload.selectedCombinationAvailable !== "boolean") throw new PharmacyOfferReadError("OFFER_READ_FAILED");
    return { offers, unavailableOfferIds: payload.unavailableOfferIds as string[], selectedCombinationAvailable: payload.selectedCombinationAvailable };

  } catch (error) {
    if (error instanceof PharmacyOfferReadError) throw error;
    throw new PharmacyOfferReadError("OFFER_NETWORK_ERROR");
  }
}
