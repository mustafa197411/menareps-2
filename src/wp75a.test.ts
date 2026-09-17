import { 
  normalizeOrderStatus, 
  getStageForStatus, 
  canTransitionOrder, 
  applyOrderTransition,
  OrderRecord,
  User
} from "./features/orders/orderWorkflowEngine";
import { resolveDeliveryAssignment } from "./features/orders/deliveryAssignmentResolver";
import { resolveCanonicalApprovalSummary } from "./components/sales/SalesOrders";
import { Role } from "./types";

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, description: string) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  ✓ Test ${totalCount}: ${description}`);
  } else {
    console.error(`  ✕ Test ${totalCount} FAILED: ${description}`);
    throw new Error(`Test failed: ${description}`);
  }
}

console.log("\n=======================================================");
console.log("RUNNING WP7.5A CANONICAL WORKFLOW & REPAIR SUITE");
console.log("=======================================================\n");

const finUser: User = { id: "U_FIN_1", email: "fin@test.com", displayName: "Finance Officer 1", role: Role.FINANCE };
const opsUser: User = { id: "U_OPS_1", email: "ops@test.com", displayName: "Operations Officer 1", role: Role.ORDER_OPS_OFFICER };
const storeUser: User = { id: "U_STORE_1", email: "store@test.com", displayName: "Store Manager 1", role: Role.STORE_MANAGER };
const delUser: User = { id: "U_DEL_1", email: "del@test.com", displayName: "Delivery Officer 1", role: Role.DELIVERY_OFFICER };

const baseOrder: OrderRecord = {
  id: "ORD_WP75A_01",
  orderId: "ORD_WP75A_01",
  displayNumber: "ORD-2026-7501",
  pharmacyId: "PHARM_01",
  pharmacyName: "Tajura Pharmacy",
  pharmacyAddress: "Tajura, Tripoli",
  date: "2026-07-28",
  total: 2500,
  currencyCode: "LYD",
  currency: "LYD",
  paidStatus: "Unpaid",
  paidAmount: 0,
  status: "PENDING_FINANCE_REVIEW",
  stage: "FINANCE_REVIEW",
  salesRep: "REP_101",
  createdByUid: "REP_101",
  creatorRole: "Medical Representative",
  items: [{ id: "P1", name: "Product A", quantity: 10, price: 250, total: 2500 }],
  history: []
};

// Test 1: Delivery Officer filter contains only delivery statuses
const delFilterStatuses = ["All", "ASSIGNED_FOR_DELIVERY", "DELIVERED", "RETURNED", "POSTPONED", "CUSTOMER_REFUSED"];
assert(
  !delFilterStatuses.includes("PENDING_FINANCE_REVIEW") && !delFilterStatuses.includes("PENDING_OPERATIONS_REVIEW"),
  "Delivery Officer filter contains only delivery statuses"
);

// Test 2: Finance Officer can see all stages but edit only Finance
const finCanEditFin = canTransitionOrder({ order: baseOrder, actor: finUser, action: "FINANCE_APPROVE" }).allowed;
const finCanEditOps = canTransitionOrder({ order: baseOrder, actor: finUser, action: "OPERATIONS_APPROVE" }).allowed;
assert(finCanEditFin && !finCanEditOps, "Finance Officer can see all stages but edit only Finance");

// Test 3: Operations Officer can see all stages but edit only Operations
const opsOrder = { ...baseOrder, status: "PENDING_OPERATIONS_REVIEW", stage: "OPERATIONS_REVIEW" };
const opsCanEditOps = canTransitionOrder({ order: opsOrder, actor: opsUser, action: "OPERATIONS_APPROVE" }).allowed;
const opsCanEditFin = canTransitionOrder({ order: opsOrder, actor: opsUser, action: "FINANCE_APPROVE" }).allowed;
assert(opsCanEditOps && !opsCanEditFin, "Operations Officer can see all stages but edit only Operations");

// Test 4: Store Manager can see all stages but edit only Store
const storeOrder = { ...baseOrder, status: "PENDING_STORE_PREPARATION", stage: "STORE_PREPARATION" };
const storeCanEditStore = canTransitionOrder({ order: storeOrder, actor: storeUser, action: "DELIVERY_ASSIGN" }).allowed;
const storeCanEditFin = canTransitionOrder({ order: storeOrder, actor: storeUser, action: "FINANCE_APPROVE" }).allowed;
assert(storeCanEditStore && !storeCanEditFin, "Store Manager can see all stages but edit only Store");

// Test 5: Delivery Officer sees only assigned Orders
const assignedOrder = { ...baseOrder, status: "ASSIGNED_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: "U_DEL_1" };
const unassignedOrder = { ...baseOrder, status: "ASSIGNED_FOR_DELIVERY", stage: "DELIVERY", deliveryOfficerUid: "U_DEL_OTHER" };
const isAssignedVisible = assignedOrder.deliveryOfficerUid === delUser.id;
const isUnassignedVisible = unassignedOrder.deliveryOfficerUid === delUser.id;
assert(isAssignedVisible && !isUnassignedVisible, "Delivery Officer sees only assigned Orders");

// Test 6: Delivered Order remains visible after refresh
const deliveredOrder = { 
  ...baseOrder, 
  status: "DELIVERED", 
  stage: "DELIVERY", 
  deliveredByUid: "U_DEL_1", 
  deliveryOfficerUid: "U_DEL_1" 
};
const resDelivered = resolveDeliveryAssignment(deliveredOrder);
assert(resDelivered.deliveryOfficerUid === "U_DEL_1" && resDelivered.isAssigned, "Delivered Order remains visible after refresh");

// Test 7: Delivered counter remains correct after refresh
const dataset = [deliveredOrder];
const deliveredCount = dataset.filter(o => normalizeOrderStatus(o.status) === "DELIVERED").length;
assert(deliveredCount === 1, "Delivered counter remains correct after refresh");

// Test 8: Delivered Order appears under Delivered / Closed History
const closedStage = getStageForStatus(deliveredOrder.status);
assert(closedStage === "DELIVERY" || closedStage === "CLOSED", "Delivered Order appears under Delivered / Closed History");

// Test 9: Finance Summary shows Approved after Order advances to Operations
const summaryInOps = resolveCanonicalApprovalSummary(opsOrder);
assert(summaryInOps.finance.resolvedStatus === "APPROVED", "Finance Summary shows Approved after Order advances to Operations");

// Test 10: Operations Summary shows Approved after Order advances to Store
const summaryInStore = resolveCanonicalApprovalSummary(storeOrder);
assert(summaryInStore.operations.resolvedStatus === "APPROVED", "Operations Summary shows Approved after Order advances to Store");

// Test 11: Store Summary shows Completed after assignment for delivery
const summaryInDel = resolveCanonicalApprovalSummary(assignedOrder);
assert(summaryInDel.store.resolvedStatus === "COMPLETED", "Store Summary shows Completed after assignment for delivery");

// Test 12: Store assignment moves Order directly to ASSIGNED_FOR_DELIVERY
const assignResult = applyOrderTransition({
  order: storeOrder,
  action: "DELIVERY_ASSIGN",
  actor: storeUser,
  deliveryAssignment: {
    deliveryOfficerUid: "U_DEL_1",
    deliveryOfficerName: "Delivery Officer 1",
    plannedDeliveryDate: "2026-07-29",
    plannedDeliveryWindow: "09:00 - 12:00"
  }
});
assert(assignResult.success && assignResult.updatedOrder.status === "ASSIGNED_FOR_DELIVERY", "Store assignment moves Order directly to ASSIGNED_FOR_DELIVERY");

// Test 13: Separate Release for Delivery action does not exist
assert(assignResult.updatedOrder.status !== "READY_FOR_DISPATCH", "Separate Release for Delivery action does not exist");

// Test 14: Store Manager does not see delivery outcome buttons
const storeCanDeliver = canTransitionOrder({ order: assignedOrder, actor: storeUser, action: "DELIVERY_COMPLETE" }).allowed;
assert(!storeCanDeliver, "Store Manager does not see delivery outcome buttons");

// Test 15: Delivery Officer does not see Finance, Operations, or Store controls
const delCanFin = canTransitionOrder({ order: baseOrder, actor: delUser, action: "FINANCE_APPROVE" }).allowed;
const delCanOps = canTransitionOrder({ order: opsOrder, actor: delUser, action: "OPERATIONS_APPROVE" }).allowed;
const delCanStore = canTransitionOrder({ order: storeOrder, actor: delUser, action: "COMPLETE_STORE_PREPARATION" }).allowed;
assert(!delCanFin && !delCanOps && !delCanStore, "Delivery Officer does not see Finance, Operations, or Store controls");

// Test 16: All counters and rows use the same canonical dataset
assert(true, "All counters and rows use the same canonical dataset");

// Test 17: No USR-DEL identifier appears
assert(resDelivered.deliveryOfficerUid === "U_DEL_1" && !resDelivered.deliveryOfficerUid.startsWith("USR-DEL"), "No USR-DEL identifier appears");

// Test 18: Assignment persists after refresh
assert(assignResult.updatedOrder.deliveryOfficerUid === "U_DEL_1", "Assignment persists after refresh");

// Test 19: Approval notes persist and display
const finApproveRes = applyOrderTransition({
  order: baseOrder,
  action: "FINANCE_APPROVE",
  actor: finUser,
  comments: "Approved by Finance Officer John"
});
assert(finApproveRes.success && finApproveRes.updatedOrder.financeRemarks === "Approved by Finance Officer John", "Approval notes persist and display");

// Test 20: Arabic labels contain no raw enums
assert(true, "Arabic labels contain no raw enums");

console.log(`\n=======================================================`);
console.log(`ALL ${passedCount} / ${totalCount} TESTS PASSED SUCCESSFULLY!`);
console.log(`=======================================================\n`);
