import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { PharmacyVisitDraft, PharmacyFinancialContext, PharmacyFinancialSourceStatus } from "../types/domain";

export async function fetchPharmacyFinancialContext(
  draft: PharmacyVisitDraft
): Promise<PharmacyFinancialContext> {
  const pharmacyId = draft.pharmacyId || draft.pharmacySnapshot?.id || "";
  let outstandingBalanceBefore = draft.pharmacySnapshot?.outstandingBalance ?? 0;
  let creditLimit: number | null = null;
  let paymentTermDays: number | null = null;
  let source = `draft/pharmacySnapshot/${pharmacyId}`;
  let sourceStatus: PharmacyFinancialSourceStatus = "PARTIAL";

  if (pharmacyId) {
    try {
      const phRef = doc(db, "pharmacies", pharmacyId);
      const snap = await getDoc(phRef);
      if (snap.exists()) {
        const data = snap.data();
        if (typeof data.outstandingBalance === "number") {
          outstandingBalanceBefore = data.outstandingBalance;
        }
        if (typeof data.creditLimit === "number") {
          creditLimit = data.creditLimit;
        }
        if (typeof data.paymentTerms === "number" || typeof data.paymentTermDays === "number") {
          paymentTermDays = data.paymentTerms ?? data.paymentTermDays ?? null;
        }
        source = `firestore/pharmacies/${pharmacyId}`;
        sourceStatus = "LIVE";
      }
    } catch (e: any) {
      console.warn("[FinancialContextService] Could not fetch live pharmacy document:", e);
      sourceStatus = "PARTIAL";
    }
  }

  const grossSubtotal = draft.order?.subtotalPreview || 0;
  const discountTotal = draft.offers?.calculation?.totalDiscountAmount || 0;
  const netTotal = draft.offers?.calculation?.netTotal ?? Math.max(0, grossSubtotal - discountTotal);
  const pSnapAny = draft.pharmacySnapshot as any;
  const currency = draft.currencyCode || draft.order?.currency || pSnapAny?.currencyCode;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new Error("MARKET_CURRENCY_CONFIGURATION_REQUIRED");

  const availableCredit = creditLimit !== null ? Math.max(0, creditLimit - outstandingBalanceBefore) : null;

  const financialContext: PharmacyFinancialContext = {
    pharmacyId,
    currency,
    outstandingBalanceBefore,
    currentVisitGrossTotal: grossSubtotal,
    currentVisitDiscountTotal: discountTotal,
    currentVisitNetTotal: netTotal,
    openReceivableTotal: outstandingBalanceBefore > 0 ? outstandingBalanceBefore : null,
    creditLimit,
    availableCredit,
    paymentTermDays,
    overdueAmount: null, // Detailed invoice aging not stored in root collections
    agingBuckets: null, // Display "Financial aging data unavailable" cleanly
    source,
    sourceStatus,
    mockFallbackUsed: false,
    backendRevalidationRequired: true
  };

  console.info(
    "[PHARMACY_VISIT_FINANCIAL_CONTEXT_JSON]",
    JSON.stringify(financialContext)
  );

  console.info(
    "[PHARMACY_VISIT_BALANCE_SOURCE_JSON]",
    JSON.stringify({
      pharmacyId,
      balanceSource: source,
      outstandingBalance: outstandingBalanceBefore,
      creditLimit,
      discrepancyDetected: false,
      timestamp: new Date().toISOString()
    })
  );

  return financialContext;
}
