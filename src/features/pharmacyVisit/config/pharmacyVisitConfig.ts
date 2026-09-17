import { PharmacyVisitPurpose } from "../types/domain";

/**
 * Feature Flag Configuration for Pharmacy Visit V2
 */
export const PHARMACY_VISIT_V2_CONFIG = {
  enabled: true,
  draftDebounceMs: 1000,
  schemaVersion: "2.0" as const
};

/**
 * Canonical Visit Purpose Registry
 */
export const CANONICAL_VISIT_PURPOSES: PharmacyVisitPurpose[] = [
  {
    code: "REGULAR_COMMERCIAL_VISIT",
    labelEn: "Regular Commercial Visit & Order Collection",
    labelAr: "زيارة تجارية دورية وتحصيل الطلبات"
  },
  {
    code: "STOCK_CHECK_OBSERVATION",
    labelEn: "Stock Level & Shelf Observation",
    labelAr: "متابعة المخزون والعرض على الرفوف"
  },
  {
    code: "PAYMENT_AR_COLLECTION",
    labelEn: "Payment & Financial Reconciliation",
    labelAr: "التحصيل والتسوية المالية"
  },
  {
    code: "NEW_PRODUCT_PROMOTION",
    labelEn: "New Launch & Offer Detailing",
    labelAr: "التعريف بمنتج جديد والعروض"
  },
  {
    code: "COMPETITOR_INTELLIGENCE",
    labelEn: "Market Survey & Competitor Intelligence",
    labelAr: "دراسة السوق ومتابعة المنافسين"
  },
  {
    code: "PHARMACY_RELATIONSHIP",
    labelEn: "Relationship Building & Follow-Up",
    labelAr: "بناء العلاقة والمتابعة"
  }
];

export function isV2PilotUser(uid?: string | null): boolean {
  if (!uid) return false;
  return PHARMACY_VISIT_V2_CONFIG.enabled;
}
