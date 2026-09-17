import { getFirebaseAdminServices } from "./firebaseAdmin";
import { executeSampleApprovalDecision, SampleApprovalError } from "./sampleApprovalService";

const { db } = getFirebaseAdminServices();
const now = "2026-08-25T00:00:00Z";
await Promise.all([
  db.collection("users").doc("MSPR").set({ id: "MSPR", name: "Supervisor Name", role: "Medical Supervisor", active: true, loginAllowed: true, status: "Active" }),
  db.collection("users").doc("OTHER-SUP").set({ id: "OTHER-SUP", name: "Other Supervisor", role: "Medical Supervisor", active: true, loginAllowed: true, status: "Active" }),
  db.collection("users").doc("medtest").set({ id: "medtest", name: "medtest", role: "Medical Representative", managerId: "MSPR", active: true, loginAllowed: true, status: "Active" }),
  db.collection("sampleRequests").doc("REQ-EMULATOR").set({ id: "REQ-EMULATOR", requesterId: "medtest", repId: "medtest", sampleSkuId: "SKU-1", productId: "PROD-1", quantityRequested: 50, reason: "Need", requestedForPhysicianId: "PHY-267", source: "STANDALONE", urgent: false, status: "PENDING_APPROVAL", createdAt: now, createdBy: "medtest" }),
]);

try {
  await executeSampleApprovalDecision("OTHER-SUP", { requestId: "REQ-EMULATOR", decision: "APPROVED", approvedQuantity: 2 }, db);
  throw new Error("UNRELATED_SUPERVISOR_WAS_NOT_DENIED");
} catch (error) {
  if (!(error instanceof SampleApprovalError) || error.code !== "SAMPLE_REQUEST_DESCENDANT_DENIED") throw error;
}
const unchanged = await db.collection("sampleRequests").doc("REQ-EMULATOR").get();
if (unchanged.data()?.status !== "PENDING_APPROVAL") throw new Error("FAILED_AUTHORIZATION_PARTIALLY_MUTATED_REQUEST");
if ((await db.collection("sampleApprovals").doc("SAP-REQ-EMULATOR").get()).exists) throw new Error("FAILED_AUTHORIZATION_CREATED_APPROVAL");

const result = await executeSampleApprovalDecision("MSPR", { requestId: "REQ-EMULATOR", decision: "APPROVED", approvedQuantity: 2 }, db);
if (result.requestStatus !== "AWAITING_ALLOCATION" || result.approvedQuantity !== 2 || result.approverId !== "MSPR" || result.approverName !== "Supervisor Name") throw new Error("AUTHORIZED_APPROVAL_RESULT_INVALID");
const [request, approval, audit, allocations] = await Promise.all([
  db.collection("sampleRequests").doc("REQ-EMULATOR").get(),
  db.collection("sampleApprovals").doc("SAP-REQ-EMULATOR").get(),
  db.collection("auditLogs").doc("AUD-SAMPLE-REQ-EMULATOR").get(),
  db.collection("sampleAllocations").get(),
]);
if (request.data()?.status !== "AWAITING_ALLOCATION" || request.data()?.repId !== "medtest") throw new Error("REQUEST_TRANSITION_INVALID");
if (!approval.exists || approval.data()?.approverId !== "MSPR" || approval.data()?.approvedQuantity !== 2 || approval.data()?.requestId !== "REQ-EMULATOR") throw new Error("APPROVAL_WRITE_INVALID");
if (!audit.exists || audit.data()?.userId !== "MSPR" || audit.data()?.userName !== "Supervisor Name") throw new Error("AUDIT_IDENTITY_INVALID");
if (!request.data()?.requestedForPhysicianId || request.data()?.requestedForPhysicianId !== "PHY-267") throw new Error("PHYSICIAN_ID_NOT_RETAINED");
if (!allocations.empty) throw new Error("APPROVAL_CREATED_ALLOCATION_PREMATURELY");
try {
  await executeSampleApprovalDecision("MSPR", { requestId: "REQ-EMULATOR", decision: "APPROVED", approvedQuantity: 2 }, db);
  throw new Error("DUPLICATE_RETRY_WAS_NOT_DENIED");
} catch (error) {
  if (!(error instanceof SampleApprovalError) || error.code !== "REQUEST_NOT_PENDING") throw error;
}
if ((await db.collection("sampleApprovals").where("requestId", "==", "REQ-EMULATOR").get()).size !== 1) throw new Error("DUPLICATE_APPROVAL_CREATED");
console.log("Sample approval Admin SDK emulator tests passed: 12");
