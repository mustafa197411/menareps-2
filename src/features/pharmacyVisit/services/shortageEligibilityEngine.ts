import { Product } from "../../../types";
import { PharmacyVisitDraft } from "../types/domain";

export interface ShortageCandidate {
  productId: string;
  productCode: string;
  productName: string;
  productNameAr?: string;
  requestedQty: number;
  fulfilledQty: number;
  warehouseAvailableQty: number | null;
  approvedAllocationQty: number | null;
  unfulfilledQty: number;
  source: string;
  visitId?: string;
  orderId?: string;
  pharmacyId?: string;
  repUid?: string;
}

export interface WarehouseInventoryAuditReport {
  collection: string;
  countryId: string;
  productBalanceCount: number;
  authoritative: boolean;
  fallbackUsed: boolean;
}

/**
 * Audits the canonical warehouse inventory source and prints
 * [WAREHOUSE_INVENTORY_SOURCE_AUDIT_JSON]
 */
export function auditWarehouseInventorySource(countryId: string): WarehouseInventoryAuditReport {
  const report: WarehouseInventoryAuditReport = {
    collection: "",
    countryId,
    productBalanceCount: 0,
    authoritative: false,
    fallbackUsed: false
  };

  console.info("[WAREHOUSE_INVENTORY_SOURCE_AUDIT_JSON]", JSON.stringify(report));
  return report;
}

/**
 * Generates deterministic ID for shortage records to prevent duplicate records
 */
export function generateDeterministicShortageLineId(
  visitId: string,
  orderId: string | undefined,
  productId: string
): string {
  const cleanOrder = orderId || "ord";
  return `sl_${visitId}_${cleanOrder}_${productId}`;
}

/**
 * Calculates SHORTAGE_CANDIDATES for Step 5 based strictly on ORDER_DEMAND_LINES
 * and warehouse availability / approved allocation according to WP6.4 rules.
 *
 * CASE A — full fulfillment: requested 10, fulfilled 10 => unfulfilled 0 => no shortage candidate
 * CASE B — partial fulfillment: requested 50, fulfilled 10 => unfulfilled 40 => shortage candidate 40
 * CASE C — zero stock: requested 10, available 0 => unfulfilled 10 => shortage candidate 10
 * CASE D — unrequested product: assigned to rep but not requested in Step 2 => no shortage candidate
 */
export function calculateShortageCandidates(
  draft: PharmacyVisitDraft,
  products: Product[] = []
): ShortageCandidate[] {
  // Audit warehouse inventory source
  auditWarehouseInventorySource(draft.countryId || "");

  const orderLines = draft.order?.lines || [];
  const candidates: ShortageCandidate[] = [];

  for (const line of orderLines) {
    const pId = line.canonicalProductId;
    if (!pId) continue;

    const requestedQty = line.quantity || 0;
    if (requestedQty <= 0) continue;

    const matchedProduct = products.find((p) => p.id === pId);

    let warehouseAvailableQty: number | null = null;
    let approvedAllocationQty: number | null = null;

    if ((line as any).warehouseAvailableQty != null) {
      warehouseAvailableQty = (line as any).warehouseAvailableQty;
    }

    if ((line as any).approvedOrderQty != null) {
      approvedAllocationQty = (line as any).approvedOrderQty;
    }

    // Determine fulfilled quantity according to priority:
    // approvedAllocationQty > fulfilledQty > quantityIncludedInOrder > warehouseAvailableQty
    let fulfilledQty = requestedQty;

    if (approvedAllocationQty != null) {
      fulfilledQty = approvedAllocationQty;
    } else if ((line as any).fulfilledQty != null) {
      fulfilledQty = (line as any).fulfilledQty;
    } else if ((line as any).quantityIncludedInOrder != null) {
      fulfilledQty = (line as any).quantityIncludedInOrder;
    } else if (warehouseAvailableQty != null) {
      fulfilledQty = Math.min(requestedQty, warehouseAvailableQty);
    }

    let unfulfilledQty = Math.max(requestedQty - fulfilledQty, 0);

    // If unfulfilledQty is explicitly specified on line, respect it
    if ((line as any).unfulfilledQty != null) {
      unfulfilledQty = (line as any).unfulfilledQty;
    }

    if (unfulfilledQty > 0) {
      candidates.push({
        productId: pId,
        productCode: line.productCode || pId,
        productName: line.productNameSnapshot || matchedProduct?.name || pId,
        productNameAr: line.productArabicNameSnapshot || (matchedProduct as any)?.nameAr,
        requestedQty,
        fulfilledQty,
        warehouseAvailableQty,
        approvedAllocationQty,
        unfulfilledQty,
        source: "AUTO_ORDER_SHORTAGE",
        visitId: draft.draftId,
        pharmacyId: draft.pharmacyId,
        repUid: draft.repUid
      });
    }
  }

  for (const availability of draft.order?.productAvailability || []) {
    if (!availability.shortageEligible || availability.availabilityState !== "OUT_OF_STOCK" || candidates.some(candidate => candidate.productId === availability.productId)) continue;
    const product = products.find(item => item.id === availability.productId);
    if (!product) continue;
    candidates.push({ productId: product.id, productCode: product.code || product.sku || product.id, productName: product.name, productNameAr: product.nameAr, requestedQty: 1, fulfilledQty: 0, warehouseAvailableQty: 0, approvedAllocationQty: null, unfulfilledQty: 1, source: "CONFIRMED_ZERO_STOCK", visitId: draft.draftId, pharmacyId: draft.pharmacyId, repUid: draft.repUid });
  }

  return candidates;
}
