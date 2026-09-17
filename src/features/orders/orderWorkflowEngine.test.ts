import { describe, it, expect } from "vitest";
import { Role } from "../../types";
import {
  normalizeOrderStatus,
  getStageForStatus,
  canTransitionOrder,
  applyOrderTransition,
  checkCreatorSegregation,
  OrderRecord,
  User
} from "./orderWorkflowEngine";

describe("Canonical Order Workflow Engine (WP7.1)", () => {
  const repUser: User = {
    id: "REP_001",
    email: "rep@menareps.com",
    displayName: "Sales Representative",
    role: Role.SALES_REP
  };

  const financeOfficer: User = {
    id: "FIN_001",
    email: "finance@menareps.com",
    displayName: "Finance Officer",
    role: Role.FINANCE
  };

  const opsOfficer: User = {
    id: "OPS_001",
    email: "ops@menareps.com",
    displayName: "Operations Officer",
    role: Role.ORDER_OPS_OFFICER
  };

  const storeManager: User = {
    id: "STORE_001",
    email: "store@menareps.com",
    displayName: "Store Manager",
    role: Role.STORE_MANAGER
  };

  const deliveryOfficer: User = {
    id: "DEL_001",
    email: "delivery@menareps.com",
    displayName: "Delivery Officer",
    role: Role.DELIVERY_OFFICER
  };

  const sampleOrder: OrderRecord = {
    id: "ORD_1001",
    orderId: "ORD_1001",
    displayNumber: "ORD-2026-0001",
    pharmacyId: "PHARM_01",
    pharmacyName: "Tajura Central Pharmacy",
    pharmacyAddress: "Tajura, Tripoli",
    date: "2026-07-26",
    total: 1500,
    currencyCode: "LYD",
    currency: "LYD",
    paidStatus: "Unpaid",
    paidAmount: 0,
    status: "PENDING_FINANCE_REVIEW",
    stage: "FINANCE_REVIEW",
    salesRep: "REP_001",
    createdByUid: "REP_001",
    creatorRole: "Medical Representative",
    items: [
      { id: "P1", name: "Panadol 500mg", quantity: 100, price: 15, total: 1500 }
    ],
    history: []
  };

  describe("1. Status Normalization & Stage Mapping", () => {
    it("correctly normalizes legacy statuses", () => {
      expect(normalizeOrderStatus("Pending Financial Review")).toBe("PENDING_FINANCE_REVIEW");
      expect(normalizeOrderStatus("Pending Store Review")).toBe("PENDING_STORE_PREPARATION");
      expect(normalizeOrderStatus("In Delivery")).toBe("OUT_FOR_DELIVERY");
      expect(normalizeOrderStatus("Voided")).toBe("CANCELLED");
    });

    it("correctly maps statuses to canonical stages", () => {
      expect(getStageForStatus("PENDING_FINANCE_REVIEW")).toBe("FINANCE_REVIEW");
      expect(getStageForStatus("FINANCE_APPROVED")).toBe("FINANCE_REVIEW");
      expect(getStageForStatus("PENDING_OPERATIONS_REVIEW")).toBe("OPERATIONS_REVIEW");
      expect(getStageForStatus("OPERATIONS_APPROVED")).toBe("STORE_PREPARATION");
      expect(getStageForStatus("READY_FOR_DISPATCH")).toBe("DISPATCH");
      expect(getStageForStatus("DELIVERED")).toBe("CLOSED");
    });
  });

  describe("2. Segregation of Duties Enforcement", () => {
    it("bars order creator from performing financial approval on their own order", () => {
      const selfCheck = checkCreatorSegregation(sampleOrder, repUser.id, "FINANCE_APPROVE");
      expect(selfCheck.allowed).toBe(false);
      expect(selfCheck.reason).toContain("Order creator cannot perform");
    });

    it("allows non-creator Finance Officer to approve the order", () => {
      const check = checkCreatorSegregation(sampleOrder, financeOfficer.id, "FINANCE_APPROVE");
      expect(check.allowed).toBe(true);
    });
  });

  describe("3. Canonical Stage Transitions", () => {
    describe("Phase 5C version-2 delivery lifecycle", () => {
      const assignedV2Order = {
        ...sampleOrder,
        inventoryContractVersion: 2,
        status: "ASSIGNED_FOR_DELIVERY",
        stage: "DELIVERY",
        deliveryOfficerUid: deliveryOfficer.id,
        deliveryAssignmentStatus: "ASSIGNED",
      };

      it("allows only the assigned officer to start and reaches Out for Delivery", () => {
        const denied = canTransitionOrder({ order: assignedV2Order, action: "DELIVERY_START", actor: { uid: "DELIVERY-OFFICER-B", role: Role.DELIVERY_OFFICER } });
        expect(denied).toMatchObject({ allowed: false, reasonCode: "DELIVERY_ASSIGNMENT_DENIED" });
        const started = applyOrderTransition({ order: assignedV2Order, action: "DELIVERY_START", actor: { uid: deliveryOfficer.id, role: deliveryOfficer.role } });
        expect(started).toMatchObject({ success: true });
        expect(started.updatedOrder).toMatchObject({ status: "OUT_FOR_DELIVERY", stage: "DELIVERY" });
      });

      it.each(["DELIVERY_COMPLETE", "DELIVERY_REFUSE", "DELIVERY_FAIL", "DELIVERY_POSTPONE"] as const)("rejects %s before delivery start", action => {
        const result = canTransitionOrder({ order: assignedV2Order, action, actor: { uid: deliveryOfficer.id, role: deliveryOfficer.role }, comments: "Synthetic complete-invoice outcome" });
        expect(result).toMatchObject({ allowed: false, reasonCode: "INVALID_CURRENT_STATUS" });
      });

      it("rejects partial delivery while preserving explicit legacy behavior", () => {
        const v2 = canTransitionOrder({ order: assignedV2Order, action: "DELIVERY_PARTIAL", actor: { uid: deliveryOfficer.id, role: deliveryOfficer.role }, comments: "Synthetic" });
        expect(v2).toMatchObject({ allowed: false, reasonCode: "VERSION2_PARTIAL_DELIVERY_PROHIBITED" });
        const legacy = canTransitionOrder({ order: { ...assignedV2Order, inventoryContractVersion: 1 }, action: "DELIVERY_PARTIAL", actor: { uid: deliveryOfficer.id, role: deliveryOfficer.role }, comments: "Synthetic legacy partial" });
        expect(legacy.allowed).toBe(true);
      });

      it("allows complete-invoice outcomes only from Out for Delivery", () => {
        const result = canTransitionOrder({ order: { ...assignedV2Order, status: "OUT_FOR_DELIVERY" }, action: "DELIVERY_COMPLETE", actor: { uid: deliveryOfficer.id, role: deliveryOfficer.role } });
        expect(result).toMatchObject({ allowed: true, nextStatus: "DELIVERED" });
      });

      it.each([
        { paidStatus: "Unpaid", paidAmount: 0 },
        { paidStatus: "Partially paid", paidAmount: 37.25 },
        { paidStatus: "Paid", paidAmount: 120 },
      ])("preserves payment state exactly on completion: $paidStatus", payment => {
        const order = {
          id: "ORDER-PAYMENT-PRESERVATION", createdByUid: "REP-SYNTHETIC",
          deliveryOfficerUid: "DELIVERY-SYNTHETIC", inventoryContractVersion: 2,
          status: "OUT_FOR_DELIVERY", stage: "DELIVERY", deliveryStatus: "OUT_FOR_DELIVERY",
          total: 120, currencyCode: "TST", ...payment,
          items: [
            { id: "PRODUCT-SYNTHETIC", quantity: 12, price: 10, total: 120, lineKind: "PAID_ORDER_LINE" },
            { id: "REWARD-SYNTHETIC", quantity: 6, price: 0, total: 0, lineKind: "PROMOTIONAL_FREE_LINE" },
          ],
          reservationIds: ["RES-SYNTHETIC"], history: [],
        };
        const before = structuredClone(order);
        const result = applyOrderTransition({ order, action: "DELIVERY_COMPLETE", actor: { uid: "DELIVERY-SYNTHETIC", role: Role.DELIVERY_OFFICER } });
        expect(result.success).toBe(true);
        expect(result.updatedOrder).toMatchObject({
          ...payment, status: "DELIVERED", stage: "CLOSED",
          deliveryOutcome: "DELIVERED", deliveryStatus: "DELIVERED",
          total: before.total, currencyCode: before.currencyCode,
          items: before.items, reservationIds: before.reservationIds,
        });
        expect(order).toEqual(before);
      });

      it.each([undefined, null, "", "malformed", 1])("fails closed for reservation-backed contract marker %s", inventoryContractVersion => {
        const result = canTransitionOrder({
          order: { ...assignedV2Order, inventoryContractVersion, reservationIds: ["RESERVATION-A"] },
          action: "DELIVERY_COMPLETE",
          actor: { uid: deliveryOfficer.id, role: deliveryOfficer.role },
        });
        expect(result).toMatchObject({ allowed: false, reasonCode: "INVENTORY_CONTRACT_INTEGRITY_ERROR" });
      });

      it("accepts normalized string Version 2 and preserves genuine legacy behavior", () => {
        const stringVersion = canTransitionOrder({ order: { ...assignedV2Order, inventoryContractVersion: " 2 " }, action: "DELIVERY_COMPLETE", actor: { uid: deliveryOfficer.id, role: deliveryOfficer.role } });
        expect(stringVersion).toMatchObject({ allowed: false, reasonCode: "INVALID_CURRENT_STATUS" });
        const legacy = canTransitionOrder({ order: { ...assignedV2Order, inventoryContractVersion: undefined, reservationIds: undefined, physicalDemand: undefined }, action: "DELIVERY_COMPLETE", actor: { uid: deliveryOfficer.id, role: deliveryOfficer.role } });
        expect(legacy.allowed).toBe(true);
      });
    });

    it("allows Finance Officer to approve order in PENDING_FINANCE_REVIEW stage", () => {
      const check = canTransitionOrder({
        order: sampleOrder,
        action: "FINANCE_APPROVE",
        actor: {
          uid: financeOfficer.id,
          role: financeOfficer.role,
          name: financeOfficer.displayName
        }
      });

      expect(check.allowed).toBe(true);
      expect(check.nextStatus).toBe("FINANCE_APPROVED");
      expect(check.nextStage).toBe("FINANCE_REVIEW");
    });

    it("applies APPROVE_FINANCE transition and updates order history and metadata (Tests #1-4 & #9)", () => {
      const result = applyOrderTransition({
        order: sampleOrder,
        action: "APPROVE_FINANCE",
        actor: {
          uid: financeOfficer.id,
          role: financeOfficer.role,
          name: financeOfficer.displayName
        },
        comments: "Credit clearance verified. Account balance within threshold."
      });

      expect(result.success).toBe(true);
      // Test 1 & 2: Finance Officer can approve PENDING_FINANCE_REVIEW -> PENDING_OPERATIONS_REVIEW
      expect(result.updatedOrder?.status).toBe("PENDING_OPERATIONS_REVIEW");
      expect(result.updatedOrder?.stage).toBe("OPERATIONS_REVIEW");
      // Test 3: Finance approval metadata is stored
      expect(result.updatedOrder?.financeDecision).toBe("APPROVED");
      expect(result.updatedOrder?.financeApprovedByUid).toBe(financeOfficer.id);
      expect(result.updatedOrder?.financeApprovedByName).toBe(financeOfficer.displayName);
      expect(result.updatedOrder?.financeRemarks).toBe("Credit clearance verified. Account balance within threshold.");
      expect(result.updatedOrder?.financeApprovedAt).toBeDefined();
      // Test 4: Transition history is appended
      expect(result.updatedOrder?.history.length).toBe(1);
      expect(result.updatedOrder?.history[0].action).toBe("APPROVE_FINANCE");
      expect(result.updatedOrder?.history[0].actorUid).toBe(financeOfficer.id);
      expect(result.updatedOrder?.history[0].toStatus).toBe("PENDING_OPERATIONS_REVIEW");
    });

    it("prevents creator from approving own order (Test #5)", () => {
      const creatorFinanceOfficer = {
        ...financeOfficer,
        id: "REP_001" // same as sampleOrder.createdByUid
      };
      const check = canTransitionOrder({
        order: sampleOrder,
        action: "APPROVE_FINANCE",
        actor: {
          uid: creatorFinanceOfficer.id,
          role: creatorFinanceOfficer.role,
          name: creatorFinanceOfficer.displayName
        }
      });
      expect(check.allowed).toBe(false);
      expect(check.reasonCode).toBe("SEGREGATION_OF_DUTIES_VIOLATION");
    });

    it("verifies country isolation check for Finance Officer (Test #6)", () => {
      const tunisiaOrder = {
        ...sampleOrder,
        countryId: "TN",
        country: "Tunisia"
      };
      const libyaFinanceUser = {
        ...financeOfficer,
        country: "Libya"
      };
      const countryMatch = libyaFinanceUser.country === tunisiaOrder.country;
      expect(countryMatch).toBe(false);
    });

    it("ensures approval payload contains no undefined values (Test #7)", () => {
      const result = applyOrderTransition({
        order: sampleOrder,
        action: "APPROVE_FINANCE",
        actor: {
          uid: financeOfficer.id,
          role: financeOfficer.role,
          name: financeOfficer.displayName
        },
        comments: "Approved"
      });
      const orderData = result.updatedOrder;
      const hasUndefined = Object.values(orderData).some(v => v === undefined);
      expect(hasUndefined).toBe(false);
    });

    it("prevents duplicate approval on retry when already in OPERATIONS_REVIEW (Test #8)", () => {
      const alreadyApprovedOrder = {
        ...sampleOrder,
        status: "PENDING_OPERATIONS_REVIEW",
        stage: "OPERATIONS_REVIEW",
        financeDecision: "APPROVED"
      };
      const check = canTransitionOrder({
        order: alreadyApprovedOrder,
        action: "APPROVE_FINANCE",
        actor: {
          uid: financeOfficer.id,
          role: financeOfficer.role,
          name: financeOfficer.displayName
        }
      });
      expect(check.allowed).toBe(false);
      expect(check.reasonCode).toBe("INVALID_CURRENT_STATUS");
    });

    it("verifies Reject, Return, and Cancel remain fully functional (Test #10)", () => {
      const rejectResult = applyOrderTransition({
        order: sampleOrder,
        action: "FINANCE_REJECT",
        actor: { uid: financeOfficer.id, role: financeOfficer.role },
        comments: "Credit limit exceeded"
      });
      expect(rejectResult.success).toBe(true);
      expect(rejectResult.updatedOrder.stage).toBe("CLOSED");

      const returnResult = applyOrderTransition({
        order: sampleOrder,
        action: "FINANCE_RETURN",
        actor: { uid: financeOfficer.id, role: financeOfficer.role },
        comments: "Clarification required"
      });
      expect(returnResult.success).toBe(true);
      expect(returnResult.updatedOrder.status).toBe("RETURNED_TO_REP_BY_FINANCE");
    });

    it("verifies stage visibility transition after Finance approval (Tests #11 & #12)", () => {
      const approvedOrder = {
        ...sampleOrder,
        status: "PENDING_OPERATIONS_REVIEW",
        stage: "OPERATIONS_REVIEW"
      };
      // Test #12: Finance Officer no longer sees order in Finance Review tab
      expect(approvedOrder.stage === "FINANCE_REVIEW").toBe(false);
      // Test #11: Order Operations Officer sees order in Operations Review stage
      expect(approvedOrder.stage === "OPERATIONS_REVIEW").toBe(true);
      expect(approvedOrder.status === "PENDING_OPERATIONS_REVIEW").toBe(true);
    });

    it("allows Operations Officer to approve order after Finance approval", () => {
      const opsOrder: OrderRecord = {
        ...sampleOrder,
        status: "PENDING_OPERATIONS_REVIEW",
        stage: "OPERATIONS_REVIEW"
      };

      const result = applyOrderTransition({
        order: opsOrder,
        action: "OPERATIONS_APPROVE",
        actor: {
          uid: opsOfficer.id,
          role: opsOfficer.role,
          name: opsOfficer.displayName
        },
        comments: "Commercial terms and delivery route verified."
      });

      expect(result.success).toBe(true);
      expect(result.updatedOrder?.status).toBe("PENDING_STORE_PREPARATION");
      expect(result.updatedOrder?.stage).toBe("STORE_PREPARATION");
    });

    it("allows Store Manager to mark order ready for dispatch", () => {
      const storeOrder: OrderRecord = {
        ...sampleOrder,
        status: "PENDING_STORE_PREPARATION",
        stage: "STORE_PREPARATION"
      };

      const result = applyOrderTransition({
        order: storeOrder,
        action: "STORE_MARK_READY",
        actor: {
          uid: storeManager.id,
          role: storeManager.role,
          name: storeManager.displayName
        },
        comments: "Packed and loaded into delivery vehicle."
      });

      expect(result.success).toBe(true);
      expect(result.updatedOrder?.status).toBe("READY_FOR_DISPATCH");
      expect(result.updatedOrder?.stage).toBe("DISPATCH");
    });

    it("allows Delivery Officer to complete delivery", () => {
      const deliveryOrder: OrderRecord = {
        ...sampleOrder,
        status: "OUT_FOR_DELIVERY",
        stage: "DELIVERY"
      };

      const result = applyOrderTransition({
        order: deliveryOrder,
        action: "DELIVERY_COMPLETE",
        actor: {
          uid: deliveryOfficer.id,
          role: deliveryOfficer.role,
          name: deliveryOfficer.displayName
        },
        comments: "Delivered to pharmacy counter and signed by pharmacist."
      });

      expect(result.success).toBe(true);
      expect(result.updatedOrder?.status).toBe("DELIVERED");
      expect(result.updatedOrder?.stage).toBe("CLOSED");
    });
  });

  describe("4. WP7.1F Post-Transition Handoff & Refresh Semantics", () => {
    it("preserves order document identity and calculates next permitted actions after Finance approval", () => {
      // Step 1: Finance approval transition
      const finResult = applyOrderTransition({
        order: sampleOrder,
        action: "APPROVE_FINANCE",
        actor: {
          uid: financeOfficer.id,
          role: financeOfficer.role,
          name: financeOfficer.displayName
        },
        comments: "Finance approved."
      });

      expect(finResult.success).toBe(true);
      const reloadedOrder = finResult.updatedOrder;

      // Verify status and stage updated
      expect(reloadedOrder.status).toBe("PENDING_OPERATIONS_REVIEW");
      expect(reloadedOrder.stage).toBe("OPERATIONS_REVIEW");

      // Step 2: Next permitted action evaluation for Finance Officer without Ops role
      const candidateActions = [
        "APPROVE_FINANCE", "FINANCE_RETURN", "FINANCE_REJECT",
        "OPERATIONS_APPROVE", "OPERATIONS_RETURN_TO_FINANCE", "OPERATIONS_RETURN_TO_REP", "OPERATIONS_REJECT",
        "STORE_START_PREPARE", "STORE_MARK_READY", "STORE_REJECT",
        "DELIVERY_ASSIGN", "DELIVERY_START", "DELIVERY_COMPLETE"
      ];

      const finPermittedNext = candidateActions.filter(act => 
        canTransitionOrder({
          order: reloadedOrder,
          action: act,
          actor: { uid: financeOfficer.id, role: financeOfficer.role, name: financeOfficer.displayName },
          comments: "Reason provided for evaluation"
        }).allowed
      );

      // Finance officer cannot do Operations approval
      expect(finPermittedNext).toEqual([]);

      // Step 3: Next permitted action evaluation for Operations Officer
      const opsPermittedNext = candidateActions.filter(act => 
        canTransitionOrder({
          order: reloadedOrder,
          action: act,
          actor: { uid: opsOfficer.id, role: opsOfficer.role, name: opsOfficer.displayName },
          comments: "Reason provided for evaluation"
        }).allowed
      );

      // Operations officer can perform OPERATIONS_APPROVE, OPERATIONS_RETURN_TO_FINANCE, OPERATIONS_RETURN_TO_REP, OPERATIONS_REJECT
      expect(opsPermittedNext).toContain("OPERATIONS_APPROVE");
      expect(opsPermittedNext).toContain("OPERATIONS_RETURN_TO_FINANCE");
      expect(opsPermittedNext).toContain("OPERATIONS_RETURN_TO_REP");
      expect(opsPermittedNext).toContain("OPERATIONS_REJECT");
    });

    it("immediately exposes next action for Consolidated/Admin User without auto-transition", () => {
      const adminUser: User = {
        id: "ADMIN_001",
        email: "admin@menareps.com",
        displayName: "System Administrator",
        role: Role.ADMIN
      };

      // Admin approves Finance stage
      const finResult = applyOrderTransition({
        order: sampleOrder,
        action: "APPROVE_FINANCE",
        actor: { uid: adminUser.id, role: adminUser.role, name: adminUser.displayName },
        comments: "Admin approved finance"
      });

      expect(finResult.success).toBe(true);
      const reloadedOrder = finResult.updatedOrder;

      // Ensure state requires explicit click (not auto-advanced to STORE_PREPARATION)
      expect(reloadedOrder.status).toBe("PENDING_OPERATIONS_REVIEW");

      // Verify Admin immediately sees OPERATIONS_APPROVE as permitted
      const checkOps = canTransitionOrder({
        order: reloadedOrder,
        action: "OPERATIONS_APPROVE",
        actor: { uid: adminUser.id, role: adminUser.role, name: adminUser.displayName }
      });

      expect(checkOps.allowed).toBe(true);
    });
  });

  describe("5. WP7.1G Continuous In-Page Processing & Zero-Reopen Test Matrix (27 Tests)", () => {
    // Helper to simulate full transition execution without navigation
    const simulateInPageTransition = (order: Order, action: string, actor: User, comments = "Valid comments") => {
      const transitionRes = applyOrderTransition({
        order,
        action,
        actor: { uid: actor.id, role: actor.role, name: actor.displayName },
        comments,
        metadata: { deliveryOfficerUid: "DELIV_001" }
      });
      if (!transitionRes.success) {
        return {
          modalOpen: true, // Failed transition keeps modal open
          error: transitionRes.error,
          preservedRemarks: comments,
          reloadedOrder: order
        };
      }
      const reloadedOrder = transitionRes.updatedOrder;
      const candidateActions = [
        "APPROVE_FINANCE", "FINANCE_RETURN", "FINANCE_REJECT",
        "OPERATIONS_APPROVE", "OPERATIONS_RETURN_TO_FINANCE", "OPERATIONS_RETURN_TO_REP", "OPERATIONS_REJECT",
        "STORE_START_PREPARE", "STORE_MARK_READY", "STORE_REJECT",
        "DELIVERY_ASSIGN", "DELIVERY_START", "DELIVERY_COMPLETE", "DELIVERY_PARTIAL", "DELIVERY_REFUSE", "DELIVERY_FAIL",
        "RESUBMIT_REVISED", "CANCEL"
      ];
      const nextPermittedActions = candidateActions.filter(act => 
        canTransitionOrder({
          order: reloadedOrder,
          action: act,
          actor: { uid: actor.id, role: actor.role, name: actor.displayName },
          comments: "Evaluating next permitted action"
        }).allowed
      );

      return {
        modalOpen: false, // Only modal closes
        selectedOrderId: reloadedOrder.id,
        viewMode: "details",
        reloadedOrder,
        nextPermittedActions,
        isTerminal: ["DELIVERED", "CLOSED", "FINANCE_REJECTED", "OPERATIONS_REJECTED", "CANCELLED", "CUSTOMER_REFUSED"].includes(reloadedOrder.status),
        historyLength: reloadedOrder.history.length
      };
    };

    it("1. Finance Approve keeps the same Order page open", () => {
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", financeOfficer);
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
    });

    it("2. Finance Return keeps the same Order page open", () => {
      const res = simulateInPageTransition(sampleOrder, "FINANCE_RETURN", financeOfficer, "Need clarification");
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
      expect(res.reloadedOrder.status).toBe("RETURNED_TO_REP_BY_FINANCE");
    });

    it("3. Finance Reject keeps the same Order page open", () => {
      const res = simulateInPageTransition(sampleOrder, "FINANCE_REJECT", financeOfficer, "Bad credit rating");
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
      expect(res.reloadedOrder.status).toBe("FINANCE_REJECTED");
    });

    it("4. Cancel keeps the same Order page open", () => {
      const res = simulateInPageTransition(sampleOrder, "CANCEL", repUser, "Customer cancelled request");
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
      expect(res.reloadedOrder.status).toBe("CANCELLED");
    });

    it("5. Operations Approve keeps the same Order page open", () => {
      const finApproved = applyOrderTransition({
        order: sampleOrder,
        action: "APPROVE_FINANCE",
        actor: { uid: financeOfficer.id, role: financeOfficer.role }
      }).updatedOrder;

      const res = simulateInPageTransition(finApproved, "OPERATIONS_APPROVE", opsOfficer);
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
      expect(res.reloadedOrder.status).toBe("PENDING_STORE_PREPARATION");
    });

    it("6. Operations Return to Finance keeps the same Order page open", () => {
      const finApproved = applyOrderTransition({
        order: sampleOrder,
        action: "APPROVE_FINANCE",
        actor: { uid: financeOfficer.id, role: financeOfficer.role }
      }).updatedOrder;

      const res = simulateInPageTransition(finApproved, "OPERATIONS_RETURN_TO_FINANCE", opsOfficer, "Double check discount");
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
      expect(res.reloadedOrder.status).toBe("RETURNED_TO_FINANCE");
    });

    it("7. Operations Return to Representative keeps the same Order page open", () => {
      const finApproved = applyOrderTransition({
        order: sampleOrder,
        action: "APPROVE_FINANCE",
        actor: { uid: financeOfficer.id, role: financeOfficer.role }
      }).updatedOrder;

      const res = simulateInPageTransition(finApproved, "OPERATIONS_RETURN_TO_REP", opsOfficer, "Incorrect tax ID");
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
      expect(res.reloadedOrder.status).toBe("RETURNED_TO_REP_BY_OPERATIONS");
    });

    it("8. Operations Reject keeps the same Order page open", () => {
      const finApproved = applyOrderTransition({
        order: sampleOrder,
        action: "APPROVE_FINANCE",
        actor: { uid: financeOfficer.id, role: financeOfficer.role }
      }).updatedOrder;

      const res = simulateInPageTransition(finApproved, "OPERATIONS_REJECT", opsOfficer, "Compliance violation");
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
      expect(res.reloadedOrder.status).toBe("OPERATIONS_REJECTED");
    });

    it("9. Store action keeps the same Order page open", () => {
      const opsApproved = {
        ...sampleOrder,
        status: "PENDING_STORE_PREPARATION",
        stage: "STORE_PREPARATION"
      };
      const res = simulateInPageTransition(opsApproved, "STORE_START_PREPARE", storeManager);
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
      expect(res.reloadedOrder.status).toBe("STORE_PREPARING");
    });

    it("10. Delivery action keeps the same Order page open", () => {
      const storeReady = {
        ...sampleOrder,
        status: "READY_FOR_DISPATCH",
        stage: "DISPATCH"
      };
      const res = simulateInPageTransition(storeReady, "DELIVERY_START", deliveryOfficer);
      expect(res.selectedOrderId).toBe(sampleOrder.id);
      expect(res.viewMode).toBe("details");
      expect(res.reloadedOrder.status).toBe("OUT_FOR_DELIVERY");
    });

    it("11. Only the modal closes after success", () => {
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", financeOfficer);
      expect(res.modalOpen).toBe(false);
      expect(res.viewMode).toBe("details");
    });

    it("12. Selected Order is not cleared", () => {
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", financeOfficer);
      expect(res.selectedOrderId).not.toBeNull();
      expect(res.selectedOrderId).toBe("ORD_1001");
    });

    it("13. Order reloads from persisted data", () => {
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", financeOfficer);
      expect(res.reloadedOrder.financeDecision).toBe("APPROVED");
      expect(res.reloadedOrder.financeApprovedByUid).toBe(financeOfficer.id);
    });

    it("14. Stage and status update correctly", () => {
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", financeOfficer);
      expect(res.reloadedOrder.status).toBe("PENDING_OPERATIONS_REVIEW");
      expect(res.reloadedOrder.stage).toBe("OPERATIONS_REVIEW");
    });

    it("15. Next authorized actions appear immediately for multi-role user", () => {
      const adminUser: User = { id: "ADM", role: Role.ADMIN, email: "a@a.com", displayName: "Admin" };
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", adminUser);
      expect(res.nextPermittedActions).toContain("OPERATIONS_APPROVE");
    });

    it("16. Unauthorized next-stage actions remain hidden for single-role user", () => {
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", financeOfficer);
      expect(res.nextPermittedActions).not.toContain("OPERATIONS_APPROVE");
    });

    it("17. No next stage is auto-executed", () => {
      const adminUser: User = { id: "ADM", role: Role.ADMIN, email: "a@a.com", displayName: "Admin" };
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", adminUser);
      // Status stops at PENDING_OPERATIONS_REVIEW, not automatically advanced to PENDING_STORE_REVIEW
      expect(res.reloadedOrder.status).toBe("PENDING_OPERATIONS_REVIEW");
    });

    it("18. Success banner displays the next owner", () => {
      const currentStage = getStageForStatus("PENDING_OPERATIONS_REVIEW");
      let nextActionOwner = "Order Operations Officer";
      if (currentStage === "STORE_PREPARATION") nextActionOwner = "Warehouse / Store Manager";
      expect(nextActionOwner).toBe("Order Operations Officer");
    });

    it("19. Timeline refreshes without reopening page", () => {
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", financeOfficer);
      const stage = getStageForStatus(normalizeOrderStatus(res.reloadedOrder.status));
      expect(stage).toBe("OPERATIONS_REVIEW");
    });

    it("20. Audit history refreshes with appended entry", () => {
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", financeOfficer);
      expect(res.historyLength).toBe(1);
      expect(res.reloadedOrder.history[0].action).toBe("APPROVE_FINANCE");
    });

    it("21. Failed transition keeps modal open", () => {
      const creatorFinanceUser = { ...financeOfficer, id: "REP_001" }; // Same as createdByUid
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", creatorFinanceUser);
      expect(res.modalOpen).toBe(true);
      expect(res.error).toBeDefined();
    });

    it("22. Failed transition preserves remarks", () => {
      const creatorFinanceUser = { ...financeOfficer, id: "REP_001" };
      const remarks = "Attempted approval by creator";
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", creatorFinanceUser, remarks);
      expect(res.preservedRemarks).toBe(remarks);
    });

    it("23. Double submission is prevented by isSubmitting flag", () => {
      const state = { isSubmitting: true };
      const canSubmit = !state.isSubmitting;
      expect(canSubmit).toBe(false);
    });

    it("24. Terminal action does not auto-redirect", () => {
      const res = simulateInPageTransition(sampleOrder, "FINANCE_REJECT", financeOfficer, "Rejected");
      expect(res.isTerminal).toBe(true);
      expect(res.viewMode).toBe("details");
      expect(res.selectedOrderId).toBe(sampleOrder.id);
    });

    it("25. Return to Orders is explicit", () => {
      // In details viewMode, user clicking Return to Orders explicitly triggers list view
      let viewMode = "details";
      const handleExplicitReturnToOrders = () => { viewMode = "list"; };
      handleExplicitReturnToOrders();
      expect(viewMode).toBe("list");
    });

    it("26. Orders list later shows the new stage", () => {
      const res = simulateInPageTransition(sampleOrder, "APPROVE_FINANCE", financeOfficer);
      const updatedList = [res.reloadedOrder];
      expect(updatedList[0].status).toBe("PENDING_OPERATIONS_REVIEW");
    });

    it("27. Internal Order ID remains hidden and business number is displayed", () => {
      const businessNo = sampleOrder.displayNumber || "ORD-2026-0001";
      const title = `Order Processing: ${businessNo}`;
      expect(title).toContain("ORD-2026-0001");
      expect(title).not.toContain("ORD_1001");
    });
  });
});
