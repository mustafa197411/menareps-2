import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "demo-menareps-wp77-certification",
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
    host: "127.0.0.1",
    port: 8089,
  },
});

let passed = 0;
let failed = 0;

async function check(name: string, operation: () => Promise<unknown>) {
  try {
    await operation();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`[FAIL] ${name}`, error);
  }
}

function actor(uid: string, email = `${uid}@example.test`) {
  return env.authenticatedContext(uid, { email }).firestore();
}

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const users = [
      { id: "admin", role: "Admin", active: true, status: "Active" },
      { id: "super-admin", role: "Super Admin", active: true, status: "Active" },
      { id: "manager", role: "Regional Manager", active: true, status: "Active" },
      { id: "supervisor", role: "Medical Supervisor", active: true, status: "Active", managerId: "manager" },
      { id: "other-supervisor", role: "Medical Supervisor", active: true, status: "Active" },
      { id: "rep-one", role: "Medical Representative", active: true, status: "Active", managerId: "supervisor" },
      { id: "rep-two", role: "Medical Representative", active: true, status: "Active", managerId: "other-supervisor" },
      { id: "restricted", role: "Delivery Officer", active: true, status: "Active" },
      { id: "navigation-only", role: "Sales Supervisor", active: true, status: "Active" },
      { id: "fresh-med-rep-a", role: "Medical Representative", active: true, status: "Operational", areaIds: ["A1"], productIds: ["P1"] },
      { id: "fresh-med-rep-b", role: "Medical Representative", active: true, status: "Operational", areaIds: ["A1"], productIds: ["P1"] },
    ];
    for (const user of users) {
      await setDoc(doc(db, "users", user.id), user);
    }

    const commonConfig = { marketId: "LY", active: true };
    await setDoc(doc(db, "marketSettings", "LY"), commonConfig);
    await setDoc(doc(db, "businessCalendarExceptions", "LY-2026-08-16"), { ...commonConfig, date: "2026-08-16" });
    await setDoc(doc(db, "accessGovernance", "Medical Representative"), { navigation: ["visits"] });
    await setDoc(doc(db, "orderWorkflowTemplates", "enterprise"), { ...commonConfig, stages: ["SUBMITTED"] });
    await setDoc(doc(db, "configurationAudit", "audit-1"), { actorId: "admin", action: "UPDATED_MARKET" });

    await setDoc(doc(db, "attendanceSessions", "rep-one-session"), { userId: "rep-one", date: "2026-08-16", status: "CLOSED" });
    await setDoc(doc(db, "attendanceSessions", "rep-two-session"), { userId: "rep-two", date: "2026-08-16", status: "CLOSED" });
    await setDoc(doc(db, "leaveRequests", "rep-one-leave"), { userId: "rep-one", status: "APPROVED", startDate: "2026-08-17" });
    await setDoc(doc(db, "leaveRequests", "rep-two-leave"), { userId: "rep-two", status: "PENDING", startDate: "2026-08-17" });
    await setDoc(doc(db, "physicianVisits", "visit-one"), { repId: "rep-one", physicianId: "PHY-504", visitDate: "2026-08-14", status: "COMPLETED" });
    await setDoc(doc(db, "physicianVisits", "visit-two"), { repId: "rep-two", physicianId: "PHY-OTHER", visitDate: "2026-08-14", status: "COMPLETED" });
    await setDoc(doc(db, "physicians", "PHY-FRESH-A"), { id: "PHY-FRESH-A", name: "Fresh A", areaId: "A1", primaryPromotionGroupId: "PG1" });
    await setDoc(doc(db, "physicians", "PHY-FRESH-B"), { id: "PHY-FRESH-B", name: "Fresh B", areaId: "A1", primaryPromotionGroupId: "PG1" });
  });

  const unauth = env.unauthenticatedContext().firestore();
  const admin = actor("admin");
  const superAdmin = actor("super-admin");
  const manager = actor("manager");
  const supervisor = actor("supervisor");
  const otherSupervisor = actor("other-supervisor");
  const repOne = actor("rep-one");
  const repTwo = actor("rep-two");
  const restricted = actor("restricted");
  const navigationOnly = actor("navigation-only");
  const freshRepA = actor("fresh-med-rep-a"); const freshRepB = actor("fresh-med-rep-b");

  const completeVisitTransaction = (db: ReturnType<typeof actor>, suffix: string, repId: string) => {
    const batch = writeBatch(db); const visitId = `VISIT-${suffix}`; const physicianId = `PHY-FRESH-${suffix}`;
    batch.set(doc(db, "physicianVisits", visitId), { id: visitId, repId, physicianId, visitDate: "2026-08-17", status: "COMPLETED" });
    batch.update(doc(db, "physicians", physicianId), { lastVisitDate: "2026-08-17", lastVisitStatus: "Completed" });
    batch.set(doc(db, "businessDocumentSequences", `SEQ-${suffix}`), { value: 1, updatedBy: repId });
    batch.set(doc(db, "auditLogs", `AUD-${suffix}`), { id: `AUD-${suffix}`, userId: repId, action: "PHYSICIAN_VISIT_COMPLETED" });
    return batch.commit();
  };

  for (const collectionName of [
    "marketSettings",
    "businessCalendarExceptions",
    "accessGovernance",
    "orderWorkflowTemplates",
  ]) {
    const documentId = collectionName === "marketSettings" ? "LY"
      : collectionName === "businessCalendarExceptions" ? "LY-2026-08-16"
      : collectionName === "accessGovernance" ? "Medical Representative"
      : "enterprise";
    await check(`unauthenticated read denied: ${collectionName}`, () => assertFails(getDoc(doc(unauth, collectionName, documentId))));
    await check(`authenticated representative reads canonical settings: ${collectionName}`, () => assertSucceeds(getDoc(doc(repOne, collectionName, documentId))));
    await check(`representative write denied: ${collectionName}`, () => assertFails(setDoc(doc(repOne, collectionName, `rep-write-${collectionName}`), { active: true })));
    await check(`Admin write allowed: ${collectionName}`, () => assertSucceeds(setDoc(doc(admin, collectionName, `admin-write-${collectionName}`), { active: true })));
  }

  await check("unauthenticated configuration audit read denied", () => assertFails(getDoc(doc(unauth, "configurationAudit", "audit-1"))));
  await check("representative configuration audit read denied", () => assertFails(getDoc(doc(repOne, "configurationAudit", "audit-1"))));
  await check("Admin configuration audit read allowed", () => assertSucceeds(getDoc(doc(admin, "configurationAudit", "audit-1"))));
  await check("Super Admin configuration audit read allowed", () => assertSucceeds(getDoc(doc(superAdmin, "configurationAudit", "audit-1"))));
  await check("representative configuration audit create denied", () => assertFails(setDoc(doc(repOne, "configurationAudit", "rep-audit"), { actorId: "rep-one" })));
  await check("Admin configuration audit create allowed", () => assertSucceeds(setDoc(doc(admin, "configurationAudit", "admin-audit"), { actorId: "admin" })));
  await check("configuration audit remains append-only for Admin", () => assertFails(updateDoc(doc(admin, "configurationAudit", "audit-1"), { action: "ALTERED" })));
  await check("configuration audit delete denied for Admin", () => assertFails(deleteDoc(doc(admin, "configurationAudit", "audit-1"))));

  await check("unauthenticated attendance read denied", () => assertFails(getDoc(doc(unauth, "attendanceSessions", "rep-one-session"))));
  await check("representative reads own attendance", () => assertSucceeds(getDoc(doc(repOne, "attendanceSessions", "rep-one-session"))));
  await check("representative cannot read another attendance", () => assertFails(getDoc(doc(repOne, "attendanceSessions", "rep-two-session"))));
  await check("supervisor reads direct-report attendance", () => assertSucceeds(getDoc(doc(supervisor, "attendanceSessions", "rep-one-session"))));
  await check("manager reads descendant attendance", () => assertSucceeds(getDoc(doc(manager, "attendanceSessions", "rep-one-session"))));
  await check("unrelated supervisor cannot read attendance", () => assertFails(getDoc(doc(otherSupervisor, "attendanceSessions", "rep-one-session"))));
  await check("restricted operational role cannot read attendance", () => assertFails(getDoc(doc(restricted, "attendanceSessions", "rep-one-session"))));
  await check("representative creates own attendance", () => assertSucceeds(setDoc(doc(repOne, "attendanceSessions", "rep-own-new"), { userId: "rep-one", status: "OPEN" })));
  await check("representative cannot create attendance for another user", () => assertFails(setDoc(doc(repOne, "attendanceSessions", "forged"), { userId: "rep-two", status: "OPEN" })));
  await check("representative cannot delete own attendance", () => assertFails(deleteDoc(doc(repOne, "attendanceSessions", "rep-one-session"))));

  await check("unauthenticated leave read denied", () => assertFails(getDoc(doc(unauth, "leaveRequests", "rep-one-leave"))));
  await check("representative reads own leave", () => assertSucceeds(getDoc(doc(repOne, "leaveRequests", "rep-one-leave"))));
  await check("representative cannot read another leave", () => assertFails(getDoc(doc(repOne, "leaveRequests", "rep-two-leave"))));
  await check("supervisor reads direct-report leave", () => assertSucceeds(getDoc(doc(supervisor, "leaveRequests", "rep-one-leave"))));
  await check("manager reads descendant leave", () => assertSucceeds(getDoc(doc(manager, "leaveRequests", "rep-one-leave"))));
  await check("unrelated supervisor cannot read leave", () => assertFails(getDoc(doc(otherSupervisor, "leaveRequests", "rep-one-leave"))));
  await check("representative creates own leave", () => assertSucceeds(setDoc(doc(repOne, "leaveRequests", "rep-own-leave"), { userId: "rep-one", status: "PENDING" })));
  await check("representative cannot create leave for another user", () => assertFails(setDoc(doc(repOne, "leaveRequests", "forged-leave"), { userId: "rep-two", status: "PENDING" })));
  await check("representative cannot approve own leave", () => assertFails(updateDoc(doc(repOne, "leaveRequests", "rep-one-leave"), { status: "APPROVED" })));
  await check("supervisor can approve direct-report leave", () => assertSucceeds(updateDoc(doc(supervisor, "leaveRequests", "rep-one-leave"), { status: "APPROVED" })));

  await check("unauthenticated physician visit read denied", () => assertFails(getDoc(doc(unauth, "physicianVisits", "visit-one"))));
  await check("representative reads own physician visit", () => assertSucceeds(getDoc(doc(repOne, "physicianVisits", "visit-one"))));
  await check("representative cannot read another physician visit", () => assertFails(getDoc(doc(repOne, "physicianVisits", "visit-two"))));
  await check("representative scoped physician visit query succeeds", () => assertSucceeds(getDocs(query(collection(repOne, "physicianVisits"), where("repId", "==", "rep-one")))));
  await check("representative cannot query another representative visits", () => assertFails(getDocs(query(collection(repOne, "physicianVisits"), where("repId", "==", "rep-two")))));
  await check("supervisor reads direct-report physician visit", () => assertSucceeds(getDoc(doc(supervisor, "physicianVisits", "visit-one"))));
  await check("unrelated supervisor cannot read physician visit", () => assertFails(getDoc(doc(otherSupervisor, "physicianVisits", "visit-one"))));
  await check("manager reads descendant physician visit", () => assertSucceeds(getDoc(doc(manager, "physicianVisits", "visit-one"))));
  await check("Admin reads physician visit", () => assertSucceeds(getDoc(doc(admin, "physicianVisits", "visit-one"))));
  await check("Super Admin reads physician visit", () => assertSucceeds(getDoc(doc(superAdmin, "physicianVisits", "visit-one"))));
  await check("restricted operational role cannot read physician visit", () => assertFails(getDoc(doc(restricted, "physicianVisits", "visit-one"))));
  await check("fresh Medical Representative A cannot bypass backend detailing authorization", () => assertFails(completeVisitTransaction(freshRepA, "A", "fresh-med-rep-a")));
  await check("fresh Medical Representative B cannot bypass backend detailing authorization", () => assertFails(completeVisitTransaction(freshRepB, "B", "fresh-med-rep-b")));

  await check("navigation governance remains visible to configured actor", () => assertSucceeds(getDoc(doc(navigationOnly, "accessGovernance", "Medical Representative"))));
  await check("navigation visibility does not grant physician visit access", () => assertFails(getDoc(doc(navigationOnly, "physicianVisits", "visit-one"))));
  await check("navigation visibility does not grant attendance access", () => assertFails(getDoc(doc(navigationOnly, "attendanceSessions", "rep-one-session"))));
  await check("representative cannot broaden access with unbounded visit list", () => assertFails(getDocs(collection(repOne, "physicianVisits"))));
  await check("representative cannot write unknown operational collection", () => assertFails(setDoc(doc(repOne, "unknownOperationalData", "forged"), { ownerId: "rep-one" })));
} finally {
  await env.cleanup();
}

console.log(`WP77_FIRESTORE_RULES_TOTAL=${passed + failed}`);
console.log(`WP77_FIRESTORE_RULES_PASSED=${passed}`);
console.log(`WP77_FIRESTORE_RULES_FAILED=${failed}`);
if (failed > 0) process.exitCode = 1;
