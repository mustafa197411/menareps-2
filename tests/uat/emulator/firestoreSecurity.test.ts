import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UAT_ENDPOINTS, UAT_PROJECT_ID } from "./constants";
import { assertProductionIsolation } from "./preflight";
import { UAT_IDENTITIES } from "./roles";

const [host, port] = UAT_ENDPOINTS.firestore.split(":");
let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
const actor = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@menareps-uat.test` }).firestore();

beforeAll(async () => {
  assertProductionIsolation();
  env = await initializeTestEnvironment({ projectId: UAT_PROJECT_ID, firestore: { host, port: Number(port), rules: readFileSync("firestore.rules", "utf8") } });
});
afterAll(async () => env.cleanup());

describe("MENAREPS 24-role Firestore security", () => {
  it.each(UAT_IDENTITIES)("authenticates synthetic $role through its canonical profile", async identity => {
    await assertSucceeds(getDoc(doc(actor(identity.uid), "users", identity.uid)));
  });

  it("denies unauthenticated canonical settings", async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "marketSettings", "LY")));
  });

  it("keeps representative attendance self-scoped", async () => {
    const db = actor("uat-medical-rep-west-a");
    await assertSucceeds(getDoc(doc(db, "attendanceSessions", "ATT-MED-A")));
    await assertFails(getDoc(doc(db, "attendanceSessions", "ATT-MED-B")));
  });

  it("keeps supervisor hierarchy bounded", async () => {
    const db = actor("uat-medical-supervisor");
    await assertSucceeds(getDoc(doc(db, "attendanceSessions", "ATT-MED-A")));
    await assertFails(getDoc(doc(db, "attendanceSessions", "ATT-MED-B")));
  });

  it("requires representative-scoped visit queries", async () => {
    const db = actor("uat-medical-rep-west-a");
    await assertSucceeds(getDocs(query(collection(db, "physicianVisits"), where("repId", "==", "uat-medical-rep-west-a"))));
    await assertFails(getDocs(collection(db, "physicianVisits")));
  });

  it("rejects direct medical Planner writes so backend policy cannot be bypassed", async () => {
    const db = actor("uat-medical-rep-west-a");
    await assertFails(setDoc(doc(db, "medicalPlannerVisits", "PLAN-DIRECT-BYPASS"), {
      id: "PLAN-DIRECT-BYPASS", repId: "uat-medical-rep-west-a", physicianId: "PHY-MED-A",
      date: "2099-05-11", time: "09:00", planningType: "monthly", month: "2099-05", week: "2099-W19", status: "Draft",
    }));
  });

  it("navigation visibility never grants operational records", async () => {
    const db = actor("uat-marketing-officer");
    await assertSucceeds(getDoc(doc(db, "accessGovernance", "Marketing Officer")));
    await assertFails(getDoc(doc(db, "attendanceSessions", "ATT-MED-A")));
  });

  it("fails closed on profile-less authentication", async () => {
    await assertFails(getDoc(doc(actor("uat-profile-less"), "marketSettings", "LY")));
  });

  it("prevents representative configuration writes", async () => {
    await assertFails(setDoc(doc(actor("uat-medical-rep-west-a"), "accessGovernance", "forged"), { active: true }));
  });

  it("prevents cross-market broad reads", async () => {
    const db = actor("uat-sales-rep-west-a");
    await assertFails(getDoc(doc(db, "orders", "ORD-OUTSIDE")));
  });

  it("uses two different representative UIDs without identity privilege", async () => {
    await assertSucceeds(getDoc(doc(actor("uat-medical-rep-west-a"), "users", "uat-medical-rep-west-a")));
    await assertSucceeds(getDoc(doc(actor("uat-medical-rep-west-b"), "users", "uat-medical-rep-west-b")));
    expect("uat-medical-rep-west-a").not.toBe("uat-medical-rep-west-b");
  });

  it("denies stale Resource RBAC grants and all direct Academic Resource mutation", async () => {
    await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), "rolePermissions", "Finance Officer"), { active: true, resourceCapabilities: { manage: true } }, { merge: true }));
    const payload = { resourceId: "RES-BYPASS", promotionGroupId: "PG-A", productIds: ["P-A"], specialtyIds: [], resourceScope: "SELECTED_PRODUCTS", uploadStatus: "COMPLETE", fileSizeBytes: 10, fileVersion: 1, active: true, uploadedByUid: "uat-finance-officer" };
    await assertFails(setDoc(doc(actor("uat-finance-officer"), "academicResources", "RES-BYPASS"), payload));
    await assertFails(setDoc(doc(actor("uat-admin"), "academicResources", "RES-ADMIN-BYPASS"), { ...payload, resourceId: "RES-ADMIN-BYPASS", uploadedByUid: "uat-admin" }));
  });

  it("denies every canonical role direct Resource metadata, visit-context, hotspot definition, and hotspot interaction access", async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "academicResources", "RES-READ-DENIED"), { resourceId: "RES-READ-DENIED", active: true });
      await setDoc(doc(context.firestore(), "physicianVisitContexts", "PVC-DENIED"), { representativeUid: "uat-medical-rep-west-a", status: "ACTIVE" });
      await setDoc(doc(context.firestore(), "detailingHotspotDefinitions", "HOT-DENIED"), { materialId: "RES-READ-DENIED", active: true });
      await setDoc(doc(context.firestore(), "detailingHotspotInteractions", "HSI-DENIED"), { interactionId: "HSI-DENIED", representativeUid: "uat-medical-rep-west-a" });
    });
    for (const { uid } of UAT_IDENTITIES) {
      await assertFails(getDoc(doc(actor(uid), "academicResources", "RES-READ-DENIED")));
      await assertFails(getDocs(collection(actor(uid), "academicResources")));
      await assertFails(getDoc(doc(actor(uid), "physicianVisitContexts", "PVC-DENIED")));
      await assertFails(getDoc(doc(actor(uid), "detailingHotspotDefinitions", "HOT-DENIED")));
      await assertFails(getDocs(collection(actor(uid), "detailingHotspotDefinitions")));
      await assertFails(setDoc(doc(actor(uid), "detailingHotspotDefinitions", `HOT-WRITE-${uid}`), { hotspotId: `HOT-WRITE-${uid}`, materialId: "RES-READ-DENIED", active: true }));
      await assertFails(getDoc(doc(actor(uid), "detailingHotspotInteractions", "HSI-DENIED")));
      await assertFails(getDocs(collection(actor(uid), "detailingHotspotInteractions")));
      await assertFails(setDoc(doc(actor(uid), "detailingHotspotInteractions", `HSI-WRITE-${uid}`), { interactionId: `HSI-WRITE-${uid}` }));
    }
  });

  it("requires physician creation through the scoped backend for non-admin medical leadership", async () => {
    const physician = { id: "PHY-DIRECT", name: "Direct Bypass", areaId: "AREA-WEST-A", countryId: "COUNTRY-LY", districtId: "DISTRICT-WEST", cityId: "CITY-WEST", specialty: "Cardiology", address: "Test", active: true };
    await assertFails(setDoc(doc(actor("uat-medical-supervisor"), "physicians", "PHY-DIRECT"), physician));
    await assertSucceeds(setDoc(doc(actor("uat-admin"), "physicians", "PHY-ADMIN"), { ...physician, id: "PHY-ADMIN" }));
  });

  it("denies direct Promotion Group and legacy Marketing content mutation", async () => {
    await assertFails(setDoc(doc(actor("uat-product-manager"), "productPromotionGroups", "PG-BYPASS"), { id: "PG-BYPASS", name: "Bypass", normalizedName: "bypass", isActive: true }));
    await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), "users", "uat-legacy-marketing"), { id: "uat-legacy-marketing", role: "Marketing", active: true, loginAllowed: true }));
    await assertFails(setDoc(doc(actor("uat-legacy-marketing"), "marketingCampaigns", "CMP-BYPASS"), { id: "CMP-BYPASS", name: "Bypass" }));
  });

  it("denies stale Sample adjustment authority outside canonical roles", async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "rolePermissions", "Finance Officer"), { active: true, sampleCapabilities: { ADJUST_SAMPLE_STOCK: true } }, { merge: true });
      await setDoc(doc(context.firestore(), "sampleInventory", "SKU-BYPASS"), { sampleSkuId: "SKU-BYPASS", totalReceived: 10, availableQuantity: 10, allocatedQuantity: 0 });
    });
    await assertFails(setDoc(doc(actor("uat-finance-officer"), "sampleInventory", "SKU-BYPASS"), { sampleSkuId: "SKU-BYPASS", totalReceived: 10, availableQuantity: 9, allocatedQuantity: 0 }));
  });
});
