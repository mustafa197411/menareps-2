import { uatEnvironment } from "../tests/uat/emulator/constants";
Object.assign(process.env, uatEnvironment("wp102-pharmacy-visit-completion-secret-000000000000000000000000"));
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_TOKEN;
const { seedEmulatorState } = await import("../tests/uat/emulator/seed");
const { getFirebaseAdminServices } = await import("./firebaseAdmin");
const { executePharmacyVisitCompletion, PharmacyVisitCompletionError } = await import("./pharmacyVisitCompletionService");
await seedEmulatorState();
const { db } = getFirebaseAdminServices();
const baseDraft: any = {
  schemaVersion: "2.0", draftId: "WP102-A", repUid: "uat-sales-rep-west-a", companyId: "SYNTHETIC", countryId: "FORGED", areaId: "WEST-A1", pharmacyId: "PHARM-COMM-A",
  pharmacySnapshot: { id: "PHARM-COMM-A", nameEn: "Forged Name", type: "Retail", areaId: "WEST-A1", outstandingBalance: 999999 }, entrySource: "PHARMACY_LIST", status: "CANCELLED", currentStep: 6,
  visitPurpose: { code: "REGULAR_COMMERCIAL_VISIT", labelEn: "Regular", labelAr: "Regular" },
  order: { lines: [{ id: "L1", canonicalProductId: "P-A", productCode: "FORGED", productNameSnapshot: "Forged", quantity: 1, unitPricePreview: 999, lineTotalPreview: 999, currency: "FORGED", inputSource: "MANUAL", userConfirmed: true, userCorrected: false, createdAt: "2030-01-01", updatedAt: "2030-01-01" }], productAvailability: [{ productId: "P-A", availabilityState: "AVAILABLE", canOrder: true, shortageEligible: false, showNumericStock: false }], subtotalPreview: 999, currency: "FORGED", updatedAt: "2030-01-01" },
  offers: { eligibleOffers: [], ineligibleOffers: [], appliedOffers: [], conflicts: [], calculation: { grossSubtotal: 999, totalDiscountAmount: 0, netTotal: 999, appliedOfferCount: 0, hasConflicts: false, calculatedAt: "2030-01-01" } },
  payment: { paymentEntry: { amount: 0, method: "CASH" }, financialContext: { outstandingBalanceBefore: 999999, projectedNetOrder: 999, projectedBalanceAfter: 999999 } }, stock: { requestLines: [] },
  createdAt: "2030-01-01", updatedAt: "2030-01-01", deviceSessionId: "S", localRevision: 1,
};
const completed = await executePharmacyVisitCompletion("uat-sales-rep-west-a", { draft: baseDraft }, { db, now: () => new Date("2030-01-02T10:00:00.000Z") });
if (!completed.success || completed.alreadyCompleted) throw new Error("WP102_AUTHORIZED_COMPLETION_FAILED");
const persisted = (await db.collection("pharmacyVisits").doc(completed.visitId).get()).data()!;
if (persisted.status !== "COMPLETED" || persisted.repId !== "uat-sales-rep-west-a" || persisted.countryId !== "LY" || persisted.currencyCode !== "TST" || persisted.orderTotal !== 7 || persisted.order.lines[0].productNameSnapshot !== "Synthetic Product A") throw new Error("WP102_SERVER_DERIVATION_FAILED");
if (Object.prototype.hasOwnProperty.call(persisted.order, "productAvailability")) throw new Error("WP102_TRANSIENT_PRODUCT_AVAILABILITY_PERSISTED");
const retry = await executePharmacyVisitCompletion("uat-sales-rep-west-a", { draft: baseDraft }, { db, now: () => new Date("2030-01-02T10:01:00.000Z") });
if (!retry.alreadyCompleted || retry.displayNumber !== completed.displayNumber) throw new Error("WP102_IDEMPOTENCY_FAILED");
for (const [label, actorUid, overrides, code] of [
  ["OUTSIDE", "uat-sales-rep-west-a", { draftId: "WP102-OUT", areaId: "WEST-A2", pharmacyId: "PHARM-COMM-OUT" }, "PHARMACY_OUTSIDE_AUTHORIZED_AREA"],
  ["UNRELATED", "uat-sales-rep-west-b", { draftId: "WP102-OTHER" }, "PHARMACY_VISIT_ACTOR_MISMATCH"],
] as const) {
  try { await executePharmacyVisitCompletion(actorUid, { draft: { ...baseDraft, ...overrides } }, { db }); throw new Error(`WP102_${label}_EXPECTED_DENIAL`); }
  catch (error) { if (!(error instanceof PharmacyVisitCompletionError) || error.code !== code) throw error; }
}
await db.collection("pharmacies").doc("PHARM-COMM-A").update({ active: false });
try { await executePharmacyVisitCompletion("uat-sales-rep-west-a", { draft: { ...baseDraft, draftId: "WP102-INACTIVE" } }, { db }); throw new Error("WP102_INACTIVE_EXPECTED_DENIAL"); }
catch (error) { if (!(error instanceof PharmacyVisitCompletionError) || error.code !== "PHARMACY_INACTIVE_OR_MISSING") throw error; }
const audit = await db.collection("auditLogs").where("entityId", "==", completed.visitId).get();
if (audit.size !== 1 || audit.docs[0].data().userId !== "uat-sales-rep-west-a") throw new Error("WP102_AUDIT_ACTOR_FAILED");
console.log("WP102_PHARMACY_VISIT_COMPLETION_SERVICE=PASS");
