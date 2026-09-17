import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Role, type User } from "./types";
import { onboardImportedUser, resolveCanonicalImportManager, type ImportedUserOnboardingDependencies } from "./lib/userImportOnboarding";

const MANAGER_UID = "o8ruILWBfsPrBtAs0G9ivf1REVB2";
const AUTH_UID = "AUTH-SALES9";
const manager: User = {
  id: MANAGER_UID, uid: MANAGER_UID, authUid: MANAGER_UID, email: "super@esnad.local", name: "Supervisor",
  role: Role.SALES_SUPERVISOR, active: true, loginAllowed: true, isDeleted: false, territory: "", region: "",
};
const row = {
  email: "sales9@esnad.local", username: "sales9", firstName: "Sales9", lastName: "Doe",
  role: Role.SALES_REP, managerEmail: "super@esnad.local", country: "Libya", district: "West", city: "Tripoli",
  areaIds: ["A-TEST5", "A-TEST6"], areaNames: ["Test 5", "Test 6"],
};

function dependencies(options: { existingAuth?: boolean; authUid?: string; failVerify?: boolean } = {}) {
  const persisted: any[] = [];
  const territories: any[] = [];
  const deps: ImportedUserOnboardingDependencies = {
    provisionAuth: vi.fn(async () => ({ success: true, authUid: options.authUid || AUTH_UID, existing: options.existingAuth || false })),
    persistCanonical: vi.fn(async (input) => { persisted.push(input); }),
    syncTerritories: vi.fn(async (input) => {
      territories.push(input);
      return input.areaIds.map((areaId) => `TA_${input.authUid}_${areaId}`);
    }),
    verify: vi.fn(async () => { if (options.failVerify) throw new Error("verification failed"); }),
  };
  return { deps, persisted, territories };
}

describe("WP76D canonical User Import onboarding", () => {
  it("1. new import provisions Auth and uses returned UID", async () => {
    const { deps, persisted } = dependencies(); const result = await onboardImportedUser(row, [manager], deps);
    expect(deps.provisionAuth).toHaveBeenCalledWith(expect.objectContaining({ role: Role.SALES_REP })); expect(result.authUid).toBe(AUTH_UID); expect(persisted[0].authUid).toBe(AUTH_UID);
  });
  it("2. users document ID is the Auth UID, never email key", async () => {
    const { deps } = dependencies(); const result = await onboardImportedUser(row, [manager], deps);
    expect(result.usersDocumentId).toBe(AUTH_UID); expect(result.usersDocumentId).not.toBe("sales9-esnad-local");
  });
  it("3. manager email resolves to canonical UID", () => expect(resolveCanonicalImportManager(" SUPER@ESNAD.LOCAL ", Role.SALES_REP, [manager]).managerId).toBe(MANAGER_UID));
  it("4. unresolved manager rejects row", async () => expect((await onboardImportedUser(row, [], dependencies().deps)).status).toBe("FAILED"));
  it("5. ambiguous manager rejects row", () => expect(() => resolveCanonicalImportManager("super@esnad.local", Role.SALES_REP, [manager, { ...manager, id: "OTHER" }])).toThrow("ambiguous"));
  it("6. inactive or login-disabled manager is rejected", () => expect(() => resolveCanonicalImportManager("super@esnad.local", Role.SALES_REP, [{ ...manager, loginAllowed: false }])).toThrow("not operational"));
  it("7. existing Auth email is reused without misclassifying a new users document", async () => expect((await onboardImportedUser(row, [manager], dependencies({ existingAuth: true }).deps)).status).toBe("CREATED"));
  it("8. identity conflict rejects row", async () => expect((await onboardImportedUser(row, [manager], dependencies({ authUid: "DIFFERENT" }).deps, "EXISTING")).error).toContain("Identity conflict"));
  it("9. multi-Area import preserves both canonical IDs", async () => {
    const { deps, persisted, territories } = dependencies(); const result = await onboardImportedUser(row, [manager], deps);
    expect(persisted[0].areaIds).toEqual(["A-TEST5", "A-TEST6"]); expect(territories[0].areaIds).toEqual(["A-TEST5", "A-TEST6"]); expect(result.territoryAssignmentCount).toBe(2);
  });
  it("10. omitted products remain empty and readiness is pending", async () => {
    const result = await onboardImportedUser(row, [manager], dependencies().deps);
    expect(result.productAssignmentCount).toBe(0); expect(result.readiness).toBe("Awaiting Operational Assignment"); expect(result.status).toBe("CREATED");
  });
  it("11. post-Auth verification failure is reported as partial before counting", async () => expect((await onboardImportedUser(row, [manager], dependencies({ failVerify: true }).deps)).status).toBe("PARTIAL"));
  it("12. truthful resources contain canonical user and territory IDs only", async () => {
    const result = await onboardImportedUser(row, [manager], dependencies().deps);
    expect(result.resourceIds).toContainEqual({ id: AUTH_UID, collection: "users", operation: "CREATED" });
    expect(result.resourceIds.some((item) => item.collection === "users" && item.id === "sales9-esnad-local")).toBe(false);
  });
  it("13. repeated canonical import is safely an update", async () => expect((await onboardImportedUser(row, [manager], dependencies({ existingAuth: true }).deps, AUTH_UID)).status).toBe("UPDATED"));
});

describe("WP76D integration contracts", () => {
  const firestore = () => fs.readFileSync(new URL("./lib/firestoreService.ts", import.meta.url), "utf8");
  const app = () => fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const users = () => fs.readFileSync(new URL("./components/UserManagement.tsx", import.meta.url), "utf8");
  it("14. partial email-key activation is linked instead of deleted", () => {
    expect(firestore()).toContain('canonicalActivationProfileId: input.authUid');
    expect(firestore()).toContain('batch.set(doc(db, "userActivationProfiles", emailKey)');
  });
  it("15. linked activation semantics are used=true and canonical UID", () => {
    expect(firestore()).toContain("used: true"); expect(firestore()).toContain("operationalUserId: input.authUid");
  });
  it("16. App reuses manual Auth provisioning and verifies persistence", () => {
    expect(app()).toContain("createAuthUserViaAdminApi({ email: targetEmail, name, role: targetRole, disabled: true })");
    expect(app()).toContain("verifyCanonicalImportedUser({ ...input, expectNoProducts:");
  });
  it("17. User history records per-row results and real resource IDs", () => {
    expect(app()).toContain("newHistory.recordsBackup = createdBackup");
    expect(app()).toContain("newHistory.rowResults = rowResults");
  });
  it("18. manual Add User still provisions Auth before canonical profile", () => {
    const source = users(); const authIndex = source.indexOf("createAuthUserViaAdminApi({"); const profileIndex = source.indexOf("createPendingUserWithActivationProfile({", authIndex);
    expect(authIndex).toBeGreaterThan(-1); expect(profileIndex).toBeGreaterThan(authIndex);
  });
  it("19. canonical profile receives role, manager, and geography together", async () => {
    const { deps, persisted } = dependencies(); await onboardImportedUser(row, [manager], deps);
    expect(persisted[0]).toMatchObject({ role: Role.SALES_REP, managerId: MANAGER_UID, managerEmail: "super@esnad.local", country: "Libya", district: "West", city: "Tripoli", areaIds: ["A-TEST5", "A-TEST6"] });
  });
  it("20. identity conflict performs no profile or territory write", async () => {
    const { deps } = dependencies({ authUid: "DIFFERENT" }); await onboardImportedUser(row, [manager], deps, "EXISTING");
    expect(deps.persistCanonical).not.toHaveBeenCalled(); expect(deps.syncTerritories).not.toHaveBeenCalled();
  });
  it("21. successful canonical activation stores required linkage fields", () => {
    const source = firestore();
    expect(source).toContain("linkedToUid: input.authUid"); expect(source).toContain("operationalUserId: input.authUid"); expect(source).toContain("used: !!input.authUid");
  });
  it("22. omitted Products do not create placeholders", () => {
    expect(app()).toContain("assignedProductIds: existingUserRecord?.products || []");
    expect(app()).not.toContain('assignedProductIds: ["PLACEHOLDER"]');
  });
  it("23. partial rows cannot produce Completed history", () => {
    expect(app()).toContain('failed.length === 0 ? "Completed" : persistedDocumentIds.length > 0 ? "Partial" : "Failed"');
  });
  it("24. Areas alias is resolved through the shared canonical hierarchy resolver", () => {
    const importer = fs.readFileSync(new URL("./components/ImportModule.tsx", import.meta.url), "utf8");
    expect(importer).toContain('record["Area Names"] || record["Areas"]'); expect(importer).toContain("resolveGeographyTuple(");
  });
  it("25. WP76C bounded server assignment files remain independent of User Import", () => {
    const delivery = fs.readFileSync(new URL("../server/deliveryAssignmentService.ts", import.meta.url), "utf8");
    expect(delivery).not.toContain("userImportOnboarding"); expect(delivery).toContain('action: "DELIVERY_ASSIGN"');
  });
});
