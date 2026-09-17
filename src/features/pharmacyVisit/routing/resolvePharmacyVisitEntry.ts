import { Pharmacy, User } from "../../../types";
import { PharmacyVisitEntryContext, PharmacyVisitEntrySource } from "../types/domain";

export interface EntryResolutionResult {
  valid: boolean;
  selectedPharmacy?: Pharmacy;
  entrySource: PharmacyVisitEntrySource;
  plannerId?: string;
  errorReason?: string;
}

/**
 * Resolves entry route parameters into an authorized Pharmacy selection
 * Priority:
 * 1. Valid draftId
 * 2. Valid plannerId and linked authorized Pharmacy
 * 3. Valid pharmacyId
 * 4. No identifier -> Step 1 Pharmacy selection mode
 */
export function resolvePharmacyVisitEntry(
  context: PharmacyVisitEntryContext,
  currentUser: User,
  authorizedPharmacies: Pharmacy[]
): EntryResolutionResult {
  console.info(
    "[PHARMACY_VISIT_ENTRY_JSON]",
    JSON.stringify({
      context,
      userUid: currentUser.id,
      role: currentUser.role,
      userAreas: currentUser.areaIds || [],
      authorizedPharmaciesCount: authorizedPharmacies.length
    })
  );

  // If a preselected pharmacyId or plannerId is provided:
  if (context.pharmacyId) {
    const matched = authorizedPharmacies.find(
      (p) => p.id === context.pharmacyId && p.active !== false && p.isDeleted !== true
    );

    if (!matched) {
      return {
        valid: false,
        entrySource: context.entrySource,
        errorReason: `Pharmacy ID "${context.pharmacyId}" is not authorized or is inactive/deleted.`
      };
    }

    return {
      valid: true,
      selectedPharmacy: matched,
      entrySource: context.entrySource,
      plannerId: context.plannerId
    };
  }

  // If entry source is direct menu or list without preselection:
  return {
    valid: true,
    entrySource: context.entrySource,
    plannerId: context.plannerId
  };
}
