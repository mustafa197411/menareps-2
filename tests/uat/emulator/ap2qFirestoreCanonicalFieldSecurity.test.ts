import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";
import { UAT_ENDPOINTS, UAT_PROJECT_ID } from "./constants";
import { assertProductionIsolation } from "./preflight";

const [host, port] = UAT_ENDPOINTS.firestore.split(":");
let env: Awaited<ReturnType<typeof initializeTestEnvironment>>;
const actor = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@menareps-uat.test` }).firestore();

const fieldCollections = [
  ["medicalPlannerVisits", "repId", "uat-medical-rep-west-a", "uat-medical-rep-west-b"],
  ["medicalPlannerApprovals", "repId", "uat-medical-rep-west-a", "uat-medical-rep-west-b"],
  ["salesPlannerVisits", "repId", "uat-sales-rep-west-a", "uat-sales-rep-west-b"],
  ["salesPlannerApprovals", "repId", "uat-sales-rep-west-a", "uat-sales-rep-west-b"],
  ["pharmacyVisitDrafts", "repUid", "uat-sales-rep-west-a", "uat-sales-rep-west-b"],
  ["marketingMaterialRequests", "repId", "uat-sales-rep-west-a", "uat-sales-rep-west-b"],
  ["kolSponsorships", "repId", "uat-sales-rep-west-a", "uat-sales-rep-west-b"],
  ["stockRequests", "representativeUid", "uat-sales-rep-west-a", "uat-sales-rep-west-b"],
  ["payments", "createdBy", "uat-sales-rep-west-a", "uat-sales-rep-west-b"],
  ["detailingMaterialUsage", "representativeUid", "uat-medical-rep-west-a", "uat-medical-rep-west-b"],
  ["detailingPageAnalytics", "representativeUid", "uat-medical-rep-west-a", "uat-medical-rep-west-b"],
] as const;

beforeAll(async () => {
  assertProductionIsolation();
  env = await initializeTestEnvironment({
    projectId: UAT_PROJECT_ID,
    firestore: { host, port: Number(port), rules: readFileSync("firestore.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const writes: Promise<unknown>[] = [
      setDoc(doc(db, "pharmacies", "AP2Q-PHARM-A"), { id: "AP2Q-PHARM-A", areaId: "WEST-A1", countryId: "LY", assignedRepId: "uat-sales-rep-west-a", active: true }),
      setDoc(doc(db, "pharmacies", "AP2Q-PHARM-B"), { id: "AP2Q-PHARM-B", areaId: "WEST-A2", countryId: "LY", assignedRepId: "uat-sales-rep-west-b", active: true }),
      setDoc(doc(db, "pharmacies", "AP2Q-PHARM-EAST"), { id: "AP2Q-PHARM-EAST", areaId: "EAST-A1", countryId: "LY", assignedRepId: "uat-unrelated-rep", active: true }),
      setDoc(doc(db, "pharmacyVisits", "AP2Q-PV-A"), { id: "AP2Q-PV-A", repId: "uat-sales-rep-west-a", areaId: "WEST-A1", pharmacyId: "AP2Q-PHARM-A" }),
      setDoc(doc(db, "pharmacyVisits", "AP2Q-PV-B"), { id: "AP2Q-PV-B", repId: "uat-sales-rep-west-b", areaId: "WEST-A2", pharmacyId: "AP2Q-PHARM-B" }),
      setDoc(doc(db, "pharmacyVisits", "AP2Q-PV-MED"), { id: "AP2Q-PV-MED", repId: "uat-medical-rep-west-a", areaId: "WEST-A1", pharmacyId: "AP2Q-PHARM-A" }),
      setDoc(doc(db, "customerFinancialProfiles", "AP2Q-FIN-A"), { pharmacyId: "AP2Q-PHARM-A", representativeUid: "uat-sales-rep-west-a", areaId: "WEST-A1" }),
      setDoc(doc(db, "customerFinancialProfiles", "AP2Q-FIN-B"), { pharmacyId: "AP2Q-PHARM-B", representativeUid: "uat-sales-rep-west-b", areaId: "WEST-A2" }),
      setDoc(doc(db, "customerLedgerEntries", "AP2Q-LEDGER-A"), { id: "AP2Q-LEDGER-A", pharmacyId: "AP2Q-PHARM-A", representativeUid: "uat-sales-rep-west-a", areaId: "WEST-A1", createdByUid: "uat-sales-rep-west-a" }),
      setDoc(doc(db, "customerLedgerEntries", "AP2Q-LEDGER-B"), { id: "AP2Q-LEDGER-B", pharmacyId: "AP2Q-PHARM-B", representativeUid: "uat-sales-rep-west-b", areaId: "WEST-A2", createdByUid: "uat-sales-rep-west-b" }),
      setDoc(doc(db, "paymentCollections", "AP2Q-PC-A"), { paymentId: "AP2Q-PC-A", pharmacyId: "AP2Q-PHARM-A", representativeUid: "uat-sales-rep-west-a", areaId: "WEST-A1", createdByUid: "uat-sales-rep-west-a", status: "Submitted" }),
      setDoc(doc(db, "paymentCollections", "AP2Q-PC-B"), { paymentId: "AP2Q-PC-B", pharmacyId: "AP2Q-PHARM-B", representativeUid: "uat-sales-rep-west-b", areaId: "WEST-A2", createdByUid: "uat-sales-rep-west-b", status: "Submitted" }),
      setDoc(doc(db, "keyMessages", "AP2Q-KM-A"), { id: "AP2Q-KM-A", productId: "P-A", promotionGroupId: "PG-A", message: "A" }),
      setDoc(doc(db, "keyMessages", "AP2Q-KM-OUT"), { id: "AP2Q-KM-OUT", productId: "P-OUTSIDE", promotionGroupId: "PG-OUTSIDE", message: "Outside" }),
      setDoc(doc(db, "users", "uat-legacy-marketing"), { uid: "uat-legacy-marketing", role: "Marketing", active: true, status: "Active", areaIds: ["WEST-A1"], productIds: ["P-A"] }),
    ];
    for (const [name, ownerField, ownerA, ownerB] of fieldCollections) {
      writes.push(setDoc(doc(db, name, `AP2Q-${name}-A`), {
        id: `AP2Q-${name}-A`, [ownerField]: ownerA, areaId: "WEST-A1",
        physicianId: "PHY-MED-IN", pharmacyId: "AP2Q-PHARM-A", productId: "P-A", materialId: "M-A",
        visitId: "AP2Q-PV-A", usageSessionId: "US-A", status: "OPEN", durationSeconds: 1,
        pageNumber: 1, pageVisitIndex: 1,
      }));
      writes.push(setDoc(doc(db, name, `AP2Q-${name}-B`), {
        id: `AP2Q-${name}-B`, [ownerField]: ownerB, areaId: "WEST-A2",
        physicianId: "PHY-MED-OUT", pharmacyId: "AP2Q-PHARM-B", productId: "P-B", materialId: "M-B",
        visitId: "AP2Q-PV-B", usageSessionId: "US-B", status: "OPEN", durationSeconds: 1,
        pageNumber: 1, pageVisitIndex: 1,
      }));
    }
    await Promise.all(writes);
  });
});

afterAll(async () => env.cleanup());

describe("AP2Q direct Firestore attack paths", () => {
  it("scopes Pharmacy Master reads by canonical Area", async () => {
    const rep = actor("uat-sales-rep-west-a");
    await assertSucceeds(getDoc(doc(rep, "pharmacies", "AP2Q-PHARM-A")));
    await assertFails(getDoc(doc(rep, "pharmacies", "AP2Q-PHARM-B")));
    await assertFails(getDoc(doc(rep, "pharmacies", "AP2Q-PHARM-EAST")));
    await assertSucceeds(getDocs(query(collection(rep, "pharmacies"), where("areaId", "==", "WEST-A1"))));
  });

  it("allows supervisors/managers only inside canonical operational geography", async () => {
    for (const uid of ["uat-sales-supervisor", "uat-medical-manager"]) {
      const db = actor(uid);
      await assertSucceeds(getDoc(doc(db, "pharmacies", "AP2Q-PHARM-A")));
      await assertFails(getDoc(doc(db, "pharmacies", "AP2Q-PHARM-EAST")));
    }
  });

  it("denies Pharmacy Master to unknown, inactive, and profile-less identities", async () => {
    for (const uid of ["uat-unknown-role", "uat-inactive-admin", "uat-profile-less"]) {
      await assertFails(getDoc(doc(actor(uid), "pharmacies", "AP2Q-PHARM-A")));
    }
  });

  it("scopes Pharmacy Visits by owner, hierarchy, Area, and department", async () => {
    const rep = actor("uat-sales-rep-west-a");
    await assertSucceeds(getDoc(doc(rep, "pharmacyVisits", "AP2Q-PV-A")));
    await assertFails(getDoc(doc(rep, "pharmacyVisits", "AP2Q-PV-B")));
    await assertFails(getDoc(doc(rep, "pharmacyVisits", "AP2Q-PV-MED")));
    await assertSucceeds(getDocs(query(collection(rep, "pharmacyVisits"), where("repId", "==", "uat-sales-rep-west-a"), where("areaId", "==", "WEST-A1"))));

    const supervisor = actor("uat-sales-supervisor");
    await assertSucceeds(getDoc(doc(supervisor, "pharmacyVisits", "AP2Q-PV-A")));
    await assertFails(getDoc(doc(supervisor, "pharmacyVisits", "AP2Q-PV-MED")));
  });

  it.each(fieldCollections)("denies cross-owner reads and writes in %s", async (name, _ownerField, ownerA) => {
    const db = actor(ownerA);
    await assertSucceeds(getDoc(doc(db, name, `AP2Q-${name}-A`)));
    await assertFails(getDoc(doc(db, name, `AP2Q-${name}-B`)));
    await assertFails(updateDoc(doc(db, name, `AP2Q-${name}-B`), { updatedBy: "uat-sales-rep-west-a" }));
  });

  it("keeps supervisor field reads subordinate- and Area-bounded", async () => {
    const db = actor("uat-sales-supervisor");
    for (const name of ["salesPlannerVisits", "salesPlannerApprovals", "pharmacyVisitDrafts", "stockRequests", "payments"] as const) {
      await assertSucceeds(getDoc(doc(db, name, `AP2Q-${name}-A`)));
    }
    await assertFails(getDoc(doc(db, "medicalPlannerVisits", "AP2Q-medicalPlannerVisits-A")));
  });

  it("scopes financial records and rejects arbitrary representative mutation", async () => {
    const db = actor("uat-sales-rep-west-a");
    for (const [name, own, other] of [
      ["customerFinancialProfiles", "AP2Q-FIN-A", "AP2Q-FIN-B"],
      ["customerLedgerEntries", "AP2Q-LEDGER-A", "AP2Q-LEDGER-B"],
      ["paymentCollections", "AP2Q-PC-A", "AP2Q-PC-B"],
    ] as const) {
      await assertSucceeds(getDoc(doc(db, name, own)));
      await assertFails(getDoc(doc(db, name, other)));
      await assertFails(updateDoc(doc(db, name, other), { updatedByUid: "uat-sales-rep-west-a" }));
    }
  });

  it("keeps territory assignments self/subordinate scoped", async () => {
    const rep = actor("uat-sales-rep-west-a");
    await assertSucceeds(getDoc(doc(rep, "userTerritoryAssignments", "TA_uat-sales-rep-west-a_WEST-A1")));
    await assertFails(getDoc(doc(rep, "userTerritoryAssignments", "TA_uat-sales-rep-west-b_WEST-A2")));
    await assertSucceeds(getDoc(doc(actor("uat-sales-supervisor"), "userTerritoryAssignments", "TA_uat-sales-rep-west-a_WEST-A1")));
  });

  it("denies legacy and out-of-scope Key Message writes", async () => {
    await assertFails(updateDoc(doc(actor("uat-legacy-marketing"), "keyMessages", "AP2Q-KM-A"), { message: "forged" }));
    await assertFails(updateDoc(doc(actor("uat-product-manager"), "keyMessages", "AP2Q-KM-OUT"), { message: "forged" }));
    await assertFails(updateDoc(doc(actor("uat-marketing-officer"), "keyMessages", "AP2Q-KM-OUT"), { message: "forged" }));
    await assertFails(updateDoc(doc(actor("uat-unknown-role"), "keyMessages", "AP2Q-KM-A"), { message: "forged" }));
  });

  it("routes canonical scoped managers through backend and keeps explicit admin Rules authority", async () => {
    for (const uid of ["uat-product-manager", "uat-marketing-manager", "uat-marketing-officer", "uat-sales-marketing-manager"]) {
      await assertFails(updateDoc(doc(actor(uid), "keyMessages", "AP2Q-KM-A"), { message: `direct-${uid}` }));
    }
    for (const uid of ["uat-admin", "uat-super-admin"]) {
      await assertSucceeds(updateDoc(doc(actor(uid), "keyMessages", "AP2Q-KM-A"), { message: `approved-${uid}` }));
    }
  });

  it("preserves frozen organization-wide catalog reads", async () => {
    const db = actor("uat-sales-rep-west-a");
    await assertSucceeds(getDoc(doc(db, "products", "P-OUTSIDE")));
    await assertSucceeds(getDoc(doc(db, "keyMessages", "AP2Q-KM-OUT")));
  });
});
