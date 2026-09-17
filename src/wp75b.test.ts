import { Role } from "./types";
import { canAccessGroup, canAccessView } from "./lib/userPolicyEngine";
import { applyOrderTransition, canTransitionOrder } from "./features/orders/orderWorkflowEngine";
import { resolveDeliveryAssignment } from "./features/orders/deliveryAssignmentResolver";
import { resolveCanonicalApprovalSummary } from "./components/sales/SalesOrders";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

console.log("=== RUNNING WP7.5B FOCUSED TEST SUITE (20 TESTS) ===");

// Test 1
const financeUser: any = { id: "F01", name: "Finance User", role: Role.FINANCE };
assert(canAccessGroup(financeUser, "operations") === true, "Test 1a: Finance can access operations group");
assert(canAccessGroup(financeUser, "sales-and-orders") === false, "Test 1b: Finance cannot access sales-and-orders group");
assert(canAccessView(financeUser, "operations-order-operations") === true, "Test 1c: Finance can access operations-order-operations view");
console.log("✔ Test 1 passed");

// Test 2
const opsUser: any = { id: "OPS01", name: "Ops User", role: Role.ORDER_OPS_OFFICER };
assert(canAccessGroup(opsUser, "operations") === true, "Test 2a: Ops can access operations group");
assert(canAccessGroup(opsUser, "sales-and-orders") === false, "Test 2b: Ops cannot access sales-and-orders group");
assert(canAccessView(opsUser, "operations-order-operations") === true, "Test 2c: Ops can access operations-order-operations view");
console.log("✔ Test 2 passed");

// Test 3
const storeUser: any = { id: "STR01", name: "Store User", role: Role.STORE_MANAGER };
assert(canAccessGroup(storeUser, "operations") === true, "Test 3a: Store can access operations group");
assert(canAccessGroup(storeUser, "sales-and-orders") === false, "Test 3b: Store cannot access sales-and-orders group");
assert(canAccessView(storeUser, "operations-order-operations") === true, "Test 3c: Store can access operations-order-operations view");
console.log("✔ Test 3 passed");

// Test 4
const delUser: any = { id: "DEL01", name: "Delivery User", role: Role.DELIVERY_OFFICER };
assert(canAccessGroup(delUser, "operations") === true, "Test 4a: Delivery can access operations group");
assert(canAccessGroup(delUser, "sales-and-orders") === false, "Test 4b: Delivery cannot access sales-and-orders group");
assert(canAccessView(delUser, "operations-order-operations") === true, "Test 4c: Delivery can access operations-order-operations view");
console.log("✔ Test 4 passed");

// Test 5
const order1: any = { id: "ORD-101", status: "FINANCE_APPROVED", createdByUid: "REP-01" };
const financeActor = { uid: "FIN-01", role: Role.FINANCE, name: "Finance User" };
const check5 = canTransitionOrder({ order: order1, action: "OPERATIONS_APPROVE", actor: financeActor });
assert(check5.allowed === false, "Test 5: Finance Officer in OPERATIONS_REVIEW cannot transition");
console.log("✔ Test 5 passed");

// Test 6
const order2: any = { id: "ORD-102", status: "OPERATIONS_APPROVED", createdByUid: "REP-01" };
const opsActor = { uid: "OPS-01", role: Role.ORDER_OPS_OFFICER, name: "Ops User" };
const check6a = canTransitionOrder({ order: order2, action: "STORE_MARK_READY", actor: opsActor });
const check6b = canTransitionOrder({ order: order2, action: "DELIVERY_ASSIGN", actor: opsActor });
assert(check6a.allowed === false, "Test 6a: Ops Officer cannot mark store ready");
assert(check6b.allowed === false, "Test 6b: Ops Officer cannot assign delivery officer");
console.log("✔ Test 6 passed");

// Test 7
const order3: any = { id: "ORD-103", status: "ASSIGNED_FOR_DELIVERY", createdByUid: "REP-01" };
const storeActor = { uid: "STR-01", role: Role.STORE_MANAGER, name: "Store User" };
const check7 = canTransitionOrder({ order: order3, action: "DELIVERY_COMPLETE", actor: storeActor });
assert(check7.allowed === false, "Test 7: Store Manager in DISPATCH cannot complete delivery");
console.log("✔ Test 7 passed");

// Test 8
const order4: any = { id: "ORD-104", status: "PENDING_FINANCE_REVIEW", createdByUid: "REP-01" };
const delActor = { uid: "DEL-01", role: Role.DELIVERY_OFFICER, name: "Delivery User" };
const check8 = canTransitionOrder({ order: order4, action: "APPROVE_FINANCE", actor: delActor });
assert(check8.allowed === false, "Test 8: Delivery Officer in FINANCE_REVIEW cannot approve finance");
console.log("✔ Test 8 passed");

// Test 9
const check9 = canTransitionOrder({ order: order2, action: "STORE_MARK_READY", actor: opsActor });
assert(check9.allowed === false, "Test 9: Ops Officer strictly forbidden from STORE_MARK_READY");
console.log("✔ Test 9 passed");

// Test 10
const res10 = applyOrderTransition({ order: order4, action: "APPROVE_FINANCE", actor: { uid: "FIN-01", role: Role.FINANCE, name: "Sami Finance" }, comments: "Verified" });
assert(res10.success === true, "Test 10a: Finance approval succeeded");
assert(res10.updatedOrder.status === "PENDING_OPERATIONS_REVIEW" || res10.updatedOrder.status === "FINANCE_APPROVED", "Test 10b: Finance approval updated status");
assert(res10.updatedOrder.financeApprovedByName === "Sami Finance", "Test 10c: Finance officer name persisted");
console.log("✔ Test 10 passed");

// Test 11
const res11 = applyOrderTransition({ order: res10.updatedOrder, action: "OPERATIONS_APPROVE", actor: { uid: "OPS-01", role: Role.ORDER_OPS_OFFICER, name: "Leila Ops" }, comments: "Approved" });
assert(res11.success === true, "Test 11a: Operations approval succeeded");
assert(res11.updatedOrder.status === "PENDING_STORE_PREPARATION" || res11.updatedOrder.status === "OPERATIONS_APPROVED", "Test 11b: Operations approval updated status");
assert(res11.updatedOrder.opsApprovedByName === "Leila Ops", "Test 11c: Operations officer name persisted");
console.log("✔ Test 11 passed");

// Test 12
const res12 = applyOrderTransition({
  order: res11.updatedOrder,
  action: "DELIVERY_ASSIGN",
  actor: { uid: "STR-01", role: Role.STORE_MANAGER, name: "Karim Store" },
  comments: "Assigned",
  metadata: {
    deliveryOfficerUid: "USR-DEL-001",
    deliveryOfficerName: "Tariq Al-Mansouri",
    plannedDeliveryDate: "2026-07-30"
  }
});
assert(res12.success === true, "Test 12a: Store Manager delivery assignment succeeded");
assert(res12.updatedOrder.status === "ASSIGNED_FOR_DELIVERY", "Test 12b: Status updated to ASSIGNED_FOR_DELIVERY");
assert(res12.updatedOrder.deliveryOfficerUid === "USR-DEL-001", "Test 12c: Delivery Officer UID persisted");
console.log("✔ Test 12 passed");

// Test 13
const resolved13 = resolveDeliveryAssignment(res12.updatedOrder);
assert(resolved13.isAssigned === true, "Test 13a: Delivery assignment isAssigned is true");
assert(resolved13.deliveryOfficerUid === "USR-DEL-001", "Test 13b: Delivery Officer UID matches");
assert(resolved13.deliveryOfficerName === "Tariq Al-Mansouri", "Test 13c: Delivery Officer Name matches");
console.log("✔ Test 13 passed");

// Test 14
const unassignedOrder: any = { id: "ORD-302", status: "OPERATIONS_APPROVED" };
const resolved14 = resolveDeliveryAssignment(unassignedOrder);
assert(resolved14.isAssigned === false, "Test 14a: Unassigned order isAssigned is false");
assert(resolved14.deliveryAssignmentStatus === "UNASSIGNED", "Test 14b: Delivery assignment status is UNASSIGNED");
console.log("✔ Test 14 passed");

// Test 15
const legacyOrder1: any = { id: "ORD-LEGACY-01", status: "ASSIGNED_FOR_DELIVERY", deliveryOfficerId: "USR-DEL-001" };
const resolved15 = resolveDeliveryAssignment(legacyOrder1);
assert(resolved15.isAssigned === true, "Test 15a: Legacy order with deliveryOfficerId resolves isAssigned = true");
assert(resolved15.deliveryOfficerUid === "USR-DEL-001", "Test 15b: Legacy deliveryOfficerId maps to deliveryOfficerUid");
console.log("✔ Test 15 passed");

// Test 16
const legacyOrder2: any = { id: "ORD-LEGACY-02", status: "ASSIGNED_FOR_DELIVERY", deliveryOfficerUid: "USR-DEL-LIBYA-01", deliveryOfficerName: "Tariq Al-Mansouri" };
const resolved16 = resolveDeliveryAssignment(legacyOrder2);
assert(resolved16.isAssigned === true, "Test 16a: Legacy order resolves assignment");
assert(resolved16.deliveryOfficerName === "Tariq Al-Mansouri", "Test 16b: Legacy delivery officer name maps correctly");
console.log("✔ Test 16 passed");

// Test 17
const orderFinSummary: any = { id: "ORD-401", status: "OPERATIONS_APPROVED", financeApprovedByName: "Mustafa Finance Officer" };
const summary17 = resolveCanonicalApprovalSummary(orderFinSummary);
assert(summary17.finance.resolvedStatus === "APPROVED", "Test 17a: Finance status is APPROVED");
assert(summary17.finance.actor === "Mustafa Finance Officer", "Test 17b: Finance actor matches explicit name");
console.log("✔ Test 17 passed");

// Test 18
const orderOpsSummary: any = { id: "ORD-402", status: "OPERATIONS_APPROVED", opsApprovedByName: "Salma Ops Officer" };
const summary18 = resolveCanonicalApprovalSummary(orderOpsSummary);
assert(summary18.operations.resolvedStatus === "APPROVED", "Test 18a: Ops status is APPROVED");
assert(summary18.operations.actor === "Salma Ops Officer", "Test 18b: Ops actor matches explicit name");
console.log("✔ Test 18 passed");

// Test 19
const orderStrSummary: any = { id: "ORD-403", status: "ASSIGNED_FOR_DELIVERY", storeCompletedByName: "Khaled Store Manager" };
const summary19 = resolveCanonicalApprovalSummary(orderStrSummary);
assert(summary19.store.resolvedStatus === "COMPLETED", "Test 19a: Store status is COMPLETED");
assert(summary19.store.actor === "Khaled Store Manager", "Test 19b: Store actor matches explicit name");
console.log("✔ Test 19 passed");

// Test 20
const pendingFinOrder: any = { id: "ORD-501", status: "PENDING_FINANCE_REVIEW" };
const summary20 = resolveCanonicalApprovalSummary(pendingFinOrder);
assert(summary20.currentStage === "FINANCE_REVIEW", "Test 20a: PENDING_FINANCE_REVIEW maps to FINANCE_REVIEW stage");
assert(summary20.finance.resolvedStatus === "PENDING", "Test 20b: Finance status is PENDING");
console.log("✔ Test 20 passed");

console.log("\n=========================================================");
console.log("ALL 20 FOCUSED TESTS PASSED SUCCESSFULLY! (WP7.5B)");
console.log("=========================================================");
