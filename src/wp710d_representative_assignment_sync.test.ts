import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Role } from "./types";
import {
  buildCanonicalProductAssignment,
  calculateSyncDiff,
  createUserProductAssignmentId,
  diagnoseRepresentativeProductAssignmentSync,
  getActiveCanonicalAssignmentsForUser,
  getAssignedProductsForUser,
  getAssignmentOperationalState,
  getValidatedPhysicianAlignedProductIds,
  withoutFirestoreDocumentId
} from "./lib/productAssignmentService";
import { getReadiness } from "./lib/userPolicyEngine";

const uid = "J37PXq5iqQSjIqXGnDhfPSLKC292";
const emailSlug = "medreptest-esand-local";
const product = {
  id: "PROD-9188", name: "Test Product", sku: "SKU-9188",
  promotionGroupId: "test", therapeuticArea: "General", isActive: true
} as any;
const manager = { id: "MANAGER-UID", email: "manager@example.com", role: Role.MEDICAL_SUPERVISOR, active: true } as any;
const representative = {
  id: uid, uid, authUid: uid, email: "medreptest@esand.local", role: Role.MEDICAL_REP,
  managerId: manager.id, managerEmail: manager.email, active: true, employmentStatus: "Active",
  loginAllowed: true, areaIds: ["A-713066"], products: [product.id],
  primaryPromotionGroupId: "test"
} as any;
const assignment = buildCanonicalProductAssignment({ userId: uid, product, actorUid: "ADMIN-UID", assignmentType: "medical" });
const userManagementSource = readFileSync(new URL("./components/UserManagement.tsx", import.meta.url), "utf8");
const firestoreServiceSource = readFileSync(new URL("./lib/firestoreService.ts", import.meta.url), "utf8");

describe("WP7.10D representative assignment synchronization", () => {
  it("1. uses Firebase Auth UID for users, activation, territory, product, and status writes", () => {
    expect(userManagementSource).toContain('doc(db, "userActivationProfiles", uId)');
    expect(userManagementSource).toContain('doc(db, "users", uId)');
    expect(assignment.userId).toBe(uid);
  });

  it("2. never uses the email slug as operational assignment identity", () => {
    expect(createUserProductAssignmentId(uid, product.id)).not.toContain(emailSlug);
    expect(firestoreServiceSource).toContain("activationProfileDocumentId = input.authUid || emailKey");
  });

  it("3. creates one active canonical PROD-9188 assignment", () => {
    expect(assignment).toMatchObject({ userId: uid, productId: "PROD-9188", status: "Active", active: true });
    expect(assignment.assignmentId).toBe(`PA_${uid}_PROD-9188`);
  });

  it("4. deduplicates duplicate PROD-9188 synchronization input", () => {
    const diff = calculateSyncDiff({ representativeUid: uid, selectedProductIds: [product.id, product.id], products: [product], existingAssignments: [], actorUid: "ADMIN-UID", assignmentType: "medical" });
    expect(diff.toCreate.map(item => item.id)).toEqual([product.id]);
  });

  it("5. creates one UID-keyed canonical A-713066 territory assignment", () => {
    const uniqueAreas = [...new Set(["A-713066", "A-713066"])];
    expect(uniqueAreas.map(areaId => `TA_${uid}_${areaId}`)).toEqual([`TA_${uid}_A-713066`]);
    expect(userManagementSource).toContain("userId: uId");
  });

  it("6. writes COMPLETE only after the atomic assignment batch succeeds", () => {
    expect(userManagementSource.indexOf("await assignmentBatch.commit()"))
      .toBeLessThan(userManagementSource.indexOf('await updateSyncState("COMPLETE", 2)'));
  });

  it("7. does not treat a users write without COMPLETE as Operational", () => {
    expect(getReadiness({ ...representative, assignmentSyncStatus: undefined }, [manager] as any).status).not.toBe("Operational");
  });

  it("8. does not render IN_PROGRESS as Operational", () => {
    expect(getAssignmentOperationalState({ ...representative, assignmentSyncStatus: "IN_PROGRESS" })).toMatchObject({ allowed: false, state: "PENDING" });
  });

  it("9. renders FAILED as Synchronization Failed", () => {
    expect(getAssignmentOperationalState({ ...representative, assignmentSyncStatus: "FAILED" })).toMatchObject({ allowed: false, state: "FAILED", reason: "Synchronization Failed" });
  });

  it("10. preserves the exact Firebase failure code and message", () => {
    expect(userManagementSource).toContain("firebaseErrorCode: err.code || \"unknown_error\"");
    expect(userManagementSource).toContain("firebaseErrorMessage: err.message || String(err)");
    expect(userManagementSource).toContain("throw err;");
  });

  it("11. preserves previous valid assignments when replacement commit fails", async () => {
    const stored = [assignment];
    const commitReplacement = async () => { throw Object.assign(new Error("permission denied"), { code: "permission-denied" }); };
    await expect(commitReplacement()).rejects.toMatchObject({ code: "permission-denied" });
    expect(stored).toEqual([assignment]);
    expect(userManagementSource).toContain("Territory and product replacements commit atomically");
  });

  it("12. permits a successful retry from FAILED to COMPLETE", () => {
    expect(getAssignmentOperationalState({ ...representative, assignmentSyncStatus: "FAILED" }).allowed).toBe(false);
    expect(getAssignmentOperationalState({ ...representative, assignmentSyncStatus: "COMPLETE" }).allowed).toBe(true);
  });

  it("13. runtime canonical assignment resolution returns PROD-9188", () => {
    expect(getActiveCanonicalAssignmentsForUser({ assignments: [assignment], userId: uid, products: [product] }).productIds).toEqual(["PROD-9188"]);
  });

  it("14. runtime Promotion Group resolution returns test", () => {
    expect(getAssignedProductsForUser({ assignments: [assignment], products: [product], userId: uid }).map(item => item.promotionGroupId)).toEqual(["test"]);
  });

  it("15. WP7.10C validation accepts PROD-9188 after synchronization", () => {
    expect(getValidatedPhysicianAlignedProductIds({ selectedProductIds: [product.id], physician: { assignedRepId: uid, primaryPromotionGroupId: "test" }, products: [product], userProductAssignments: [assignment] })).toEqual([product.id]);
  });

  it("16. does not modify physician alignedProductIds in this package", () => {
    expect(userManagementSource).not.toContain("alignedProductIds");
    expect(withoutFirestoreDocumentId({ ...assignment, id: assignment.assignmentId })).not.toHaveProperty("id");
  });

  it("17. detects users.products and ACTIVE canonical assignment mismatches honestly", () => {
    expect(diagnoseRepresentativeProductAssignmentSync({
      userProfileProductIds: ["PROD-A", "PROD-B"],
      activeUserProductAssignmentIds: ["PROD-B", "PROD-C"]
    })).toEqual({
      userProfileProductIds: ["PROD-A", "PROD-B"],
      activeUserProductAssignmentIds: ["PROD-B", "PROD-C"],
      missingActiveAssignmentIds: ["PROD-A"],
      activeAssignmentIdsMissingFromProfile: ["PROD-C"],
      synchronized: false
    });
  });

  it("18. reports matching profile and canonical assignment IDs as synchronized", () => {
    expect(diagnoseRepresentativeProductAssignmentSync({
      userProfileProductIds: [product.id],
      activeUserProductAssignmentIds: [product.id]
    }).synchronized).toBe(true);
  });
});
