import { strict as assert } from "node:assert";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = "demo-menareps-wp83";
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIREBASE_CONFIG?.includes("menareps-crm-production")) throw new Error("EMULATOR_PROJECT_ISOLATION_FAILED");
if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:")) throw new Error("FIRESTORE_EMULATOR_LOOPBACK_REQUIRED");
process.env.FIREBASE_PROJECT_ID = projectId;
process.env.FIRESTORE_DATABASE_ID = "(default)";
const app = initializeApp({ projectId });
const db = getFirestore(app);
const { executeVisitMarketingRequestCreate, executeVisitMarketingRequestTransition } = await import("./visitMarketingRequestService");

const records: Array<[string, Record<string, unknown>]> = [
  ["users/REP-SYNTHETIC", { role: "Medical Representative", active: true, loginAllowed: true, status: "Active", managerId: "SUP-SYNTHETIC" }],
  ["users/SUP-SYNTHETIC", { role: "Medical Supervisor", active: true, loginAllowed: true, status: "Active", managerId: "MGR-SYNTHETIC" }],
  ["users/SUP-UNRELATED", { role: "Medical Supervisor", active: true, loginAllowed: true, status: "Active", managerId: "MGR-OTHER" }],
  ["users/MGR-SYNTHETIC", { role: "Medical Manager", active: true, loginAllowed: true, status: "Active", managerId: "EXEC-MGR-SYNTHETIC" }],
  ["users/EXEC-MGR-SYNTHETIC", { role: "Medical Manager", active: true, loginAllowed: true, status: "Active" }],
  ["users/MGR-OTHER", { role: "Medical Manager", active: true, loginAllowed: true, status: "Active" }],
  ["rolePermissions/Medical Supervisor", { active: true, viewTeamData: true, marketingRequestCapabilities: { supervisorApprove: true, supervisorReject: true } }],
  ["rolePermissions/Medical Manager", { active: true, viewTeamData: true, marketingRequestCapabilities: { finalApprove: true, finalReject: true, execute: true } }],
  ["countries/COUNTRY-SYNTHETIC", { active: true }],
  ["districts/DISTRICT-SYNTHETIC", { active: true, countryId: "COUNTRY-SYNTHETIC" }],
  ["cities/CITY-SYNTHETIC", { active: true, countryId: "COUNTRY-SYNTHETIC", districtId: "DISTRICT-SYNTHETIC" }],
  ["areas/AREA-SYNTHETIC", { active: true, countryId: "COUNTRY-SYNTHETIC", districtId: "DISTRICT-SYNTHETIC", cityId: "CITY-SYNTHETIC" }],
  ["userTerritoryAssignments/TERRITORY-SYNTHETIC", { userId: "REP-SYNTHETIC", countryId: "COUNTRY-SYNTHETIC", districtId: "DISTRICT-SYNTHETIC", cityId: "CITY-SYNTHETIC", areaId: "AREA-SYNTHETIC", status: "Active", active: true }],
  ["products/PRODUCT-SYNTHETIC", { active: true, promotionGroupId: "GROUP-SYNTHETIC" }],
  ["userProductAssignments/PRODUCT-ASSIGNMENT-SYNTHETIC", { userId: "REP-SYNTHETIC", productId: "PRODUCT-SYNTHETIC", status: "Active", active: true }],
  ["physicians/PHYSICIAN-SYNTHETIC", { active: true, areaId: "AREA-SYNTHETIC", primaryPromotionGroupId: "GROUP-SYNTHETIC" }],
];
for (const [path, data] of records) await db.doc(path).set(data);

let visitCounter = 0;
async function completedVisit() {
  visitCounter++;
  const id = `VISIT-SYNTHETIC-${visitCounter}`;
  await db.doc(`physicianVisits/${id}`).set({ id, status: "Completed", repId: "REP-SYNTHETIC", physicianId: "PHYSICIAN-SYNTHETIC", areaId: "AREA-SYNTHETIC", countryId: "COUNTRY-SYNTHETIC", marketId: "MARKET-SYNTHETIC", visitDate: "2026-08-19" });
  return id;
}
const draft = { requestType: "Other" as const, urgency: "Medium" as const, description: "Synthetic governed request", estimatedBudget: 10 };
async function rejectedCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code);
}

await rejectedCode(executeVisitMarketingRequestCreate("REP-UNKNOWN", await completedVisit(), draft, db), "REQUEST_CREATOR_NOT_AUTHORIZED");
await rejectedCode(executeVisitMarketingRequestCreate("REP-SYNTHETIC", "VISIT-UNKNOWN", draft, db), "VISIT_NOT_AUTHORIZED");
await db.doc("users/REP-SYNTHETIC").update({ active: false });
await rejectedCode(executeVisitMarketingRequestCreate("REP-SYNTHETIC", await completedVisit(), draft, db), "REQUEST_CREATOR_NOT_AUTHORIZED");
await db.doc("users/REP-SYNTHETIC").update({ active: true });
await db.doc("physicians/PHYSICIAN-SYNTHETIC").update({ areaId: "AREA-OUTSIDE" });
await rejectedCode(executeVisitMarketingRequestCreate("REP-SYNTHETIC", await completedVisit(), draft, db), "VISIT_CANONICAL_CONTEXT_INVALID");
await db.doc("physicians/PHYSICIAN-SYNTHETIC").update({ areaId: "AREA-SYNTHETIC" });
await db.doc("users/SUP-SYNTHETIC").update({ active: false });
await rejectedCode(executeVisitMarketingRequestCreate("REP-SYNTHETIC", await completedVisit(), draft, db), "CANONICAL_SUPERVISOR_REQUIRED");
await db.doc("users/SUP-SYNTHETIC").update({ active: true });
await db.doc("users/REP-SYNTHETIC").update({ managerId: "" });
await rejectedCode(executeVisitMarketingRequestCreate("REP-SYNTHETIC", await completedVisit(), draft, db), "CANONICAL_SUPERVISOR_REQUIRED");
await db.doc("users/REP-SYNTHETIC").update({ managerId: "SUP-SYNTHETIC" });

const created = await executeVisitMarketingRequestCreate("REP-SYNTHETIC", await completedVisit(), draft, db);
assert.equal(created.request.status, "PENDING_SUPERVISOR");
await rejectedCode(executeVisitMarketingRequestTransition("EXEC-MGR-SYNTHETIC", "EXECUTE", { requestId: created.request.id, comment: "Too early" }, db), "REQUEST_TRANSITION_INVALID");
await rejectedCode(executeVisitMarketingRequestTransition("SUP-UNRELATED", "SUPERVISOR_APPROVE", { requestId: created.request.id }, db), "REQUEST_SUPERVISOR_DENIED");
const supervisorApproved = await executeVisitMarketingRequestTransition("SUP-SYNTHETIC", "SUPERVISOR_APPROVE", { requestId: created.request.id, comment: "Reviewed" }, db);
assert.equal(supervisorApproved.request.status, "PENDING_FINAL_APPROVAL");
await rejectedCode(executeVisitMarketingRequestTransition("MGR-OTHER", "FINAL_APPROVE", { requestId: created.request.id }, db), "REQUEST_FINAL_APPROVER_HIERARCHY_DENIED");
await rejectedCode(executeVisitMarketingRequestTransition("REP-SYNTHETIC", "FINAL_APPROVE", { requestId: created.request.id }, db), "REQUEST_SELF_REVIEW_DENIED");
const finalApproved = await executeVisitMarketingRequestTransition("MGR-SYNTHETIC", "FINAL_APPROVE", { requestId: created.request.id }, db);
assert.equal(finalApproved.request.status, "APPROVED");
await rejectedCode(executeVisitMarketingRequestTransition("SUP-SYNTHETIC", "EXECUTE", { requestId: created.request.id, comment: "Completed" }, db), "REQUEST_FINAL_APPROVER_HIERARCHY_DENIED");
await rejectedCode(executeVisitMarketingRequestTransition("REP-SYNTHETIC", "EXECUTE", { requestId: created.request.id, comment: "Completed" }, db), "REQUEST_SELF_REVIEW_DENIED");
await rejectedCode(executeVisitMarketingRequestTransition("MGR-OTHER", "EXECUTE", { requestId: created.request.id, comment: "Completed" }, db), "REQUEST_FINAL_APPROVER_HIERARCHY_DENIED");
await db.doc("users/EXEC-MGR-SYNTHETIC").update({ active: false });
await rejectedCode(executeVisitMarketingRequestTransition("EXEC-MGR-SYNTHETIC", "EXECUTE", { requestId: created.request.id, comment: "Completed" }, db), "ACTOR_INACTIVE");
await db.doc("users/EXEC-MGR-SYNTHETIC").update({ active: true });
await db.doc("rolePermissions/Medical Manager").update({ "marketingRequestCapabilities.execute": false });
await rejectedCode(executeVisitMarketingRequestTransition("EXEC-MGR-SYNTHETIC", "EXECUTE", { requestId: created.request.id, comment: "Completed" }, db), "REQUEST_PERMISSION_OR_SCOPE_DENIED");
await db.doc("rolePermissions/Medical Manager").update({ "marketingRequestCapabilities.execute": true });
await rejectedCode(executeVisitMarketingRequestTransition("EXEC-MGR-SYNTHETIC", "EXECUTE", { requestId: created.request.id }, db), "REQUEST_EXECUTION_NOTE_REQUIRED");
const executed = await executeVisitMarketingRequestTransition("EXEC-MGR-SYNTHETIC", "EXECUTE", { requestId: created.request.id, comment: "Canonical activity completed" }, db);
assert.equal(executed.request.status, "EXECUTED");
assert.equal(executed.request.executedByUid, "EXEC-MGR-SYNTHETIC");
assert(executed.request.executedAt);
assert.equal(executed.request.executionNote, "Canonical activity completed");
await rejectedCode(executeVisitMarketingRequestTransition("EXEC-MGR-SYNTHETIC", "EXECUTE", { requestId: created.request.id, comment: "Again" }, db), "REQUEST_TRANSITION_INVALID");
await rejectedCode(executeVisitMarketingRequestTransition("MGR-SYNTHETIC", "FINAL_REJECT", { requestId: created.request.id, reason: "late" }, db), "REQUEST_TRANSITION_INVALID");
await rejectedCode(executeVisitMarketingRequestTransition("REP-SYNTHETIC", "CANCEL", { requestId: created.request.id, reason: "late" }, db), "REQUEST_TRANSITION_INVALID");

const cancelFirst = await executeVisitMarketingRequestCreate("REP-SYNTHETIC", await completedVisit(), draft, db);
assert.equal((await executeVisitMarketingRequestTransition("REP-SYNTHETIC", "CANCEL", { requestId: cancelFirst.request.id, reason: "No longer required" }, db)).request.status, "CANCELLED");
const cancelFinal = await executeVisitMarketingRequestCreate("REP-SYNTHETIC", await completedVisit(), draft, db);
await executeVisitMarketingRequestTransition("SUP-SYNTHETIC", "SUPERVISOR_APPROVE", { requestId: cancelFinal.request.id }, db);
assert.equal((await executeVisitMarketingRequestTransition("REP-SYNTHETIC", "CANCEL", { requestId: cancelFinal.request.id, reason: "Withdrawn" }, db)).request.status, "CANCELLED");

const rejected = await executeVisitMarketingRequestCreate("REP-SYNTHETIC", await completedVisit(), draft, db);
await rejectedCode(executeVisitMarketingRequestTransition("SUP-SYNTHETIC", "SUPERVISOR_REJECT", { requestId: rejected.request.id }, db), "REQUEST_REASON_REQUIRED");
assert.equal((await executeVisitMarketingRequestTransition("SUP-SYNTHETIC", "SUPERVISOR_REJECT", { requestId: rejected.request.id, reason: "Insufficient justification" }, db)).request.status, "REJECTED");

const audit = await db.collection("visitMarketingRequestAudit").get();
const canonicalAudit = audit.docs.filter(doc => doc.data().resourceType === "VISIT_MARKETING_REQUEST");
assert.equal(canonicalAudit.length, 11);
assert(canonicalAudit.every(doc => doc.data().actorUid && doc.data().occurredAt && doc.data().toStatus));
const executionAudit = canonicalAudit.find(doc => doc.data().action === "EXECUTED");
assert(executionAudit && executionAudit.data().fromStatus === "APPROVED" && executionAudit.data().toStatus === "EXECUTED" && executionAudit.data().comment === "Canonical activity completed");
console.log("WP83 Visit Marketing Request service certification passed: 34/34");
await deleteApp(app);
