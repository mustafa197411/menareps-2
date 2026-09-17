import type { User } from "../../../types";
import { completePharmacyVisitAuthoritatively } from "../../../lib/pharmacyVisitCompletionClient";
import type { PharmacyVisitDraft } from "../types/domain";
import { validateStep6 } from "../validation/validateStep6";
import { PharmacyVisitDraftService } from "./pharmacyVisitDraftService";

export interface CompletePharmacyVisitResult {
  success: boolean;
  visitId: string;
  visitDisplayNumber?: string;
  orderDisplayNumber?: string;
  alreadyCompleted?: boolean;
  orderId?: string;
  errors?: string[];
  warnings?: string[];
  authoritativeTotals?: { grossSubtotal: number; totalDiscount: number; netSubtotal: number; currencyCode: string };
  appliedOfferIds?: string[];
}

export async function completePharmacyVisitV2(
  draft: PharmacyVisitDraft,
  currentUser: User,
  finalRemarks?: string,
): Promise<CompletePharmacyVisitResult> {
  if (draft.repUid && draft.repUid !== currentUser.id) {
    return { success: false, visitId: "", errors: ["unauthorized: Cannot complete a visit draft owned by another representative."] };
  }
  const validation = validateStep6(draft);
  if (!validation.isValid) return { success: false, visitId: "", errors: validation.errors, warnings: validation.warnings };

  try {
    const completed = await completePharmacyVisitAuthoritatively(draft, finalRemarks);
    const visitId = completed.visitId || "";
    const orderDisplayNumber = completed.orderDisplayNumber;
    const orderId = completed.orderId;
    const completedAt = new Date().toISOString();
    try {
      await PharmacyVisitDraftService.saveDraftLocally({
        ...draft,
        status: "COMPLETED",
        completedVisitId: visitId,
        completedDisplayNumber: completed.displayNumber,
        completedOrderId: orderId,
        completedOrderDisplayNumber: orderDisplayNumber,
        completedAt,
        updatedAt: completedAt,
      });
    } catch (error) {
      console.warn("[completePharmacyVisitV2] Draft status mark COMPLETED warning:", error);
    }
    return {
      success: true,
      visitId,
      visitDisplayNumber: completed.displayNumber,
      orderDisplayNumber,
      orderId,
      authoritativeTotals: completed.authoritativeTotals,
      appliedOfferIds: completed.appliedOfferIds,
      alreadyCompleted: completed.alreadyCompleted,
      warnings: validation.warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PHARMACY_VISIT_COMPLETION_FAILED";
    try {
      await PharmacyVisitDraftService.saveDraftLocally({ ...draft, status: "FAILED", updatedAt: new Date().toISOString() });
    } catch (saveError) {
      console.warn("[completePharmacyVisitV2] Failed to save FAILED_COMPLETION draft state:", saveError);
    }
    return { success: false, visitId: "", errors: [message], warnings: validation.warnings };
  }
}
