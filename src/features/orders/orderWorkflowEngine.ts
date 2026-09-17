import { Role, normalizeRole } from "../../types";
import { classifyInventoryContract, INVENTORY_CONTRACT_INTEGRITY_ERROR } from "./inventoryContractClassifier";

export type OrderStage = 
  | "DRAFT"
  | "SUBMISSION"
  | "INVENTORY_RESERVATION"
  | "FINANCE_REVIEW"
  | "OPERATIONS_REVIEW"
  | "STORE_PREPARATION"
  | "DISPATCH"
  | "DELIVERY"
  | "CLOSED";

export type OrderStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "RESERVATION_PENDING"
  | "INVENTORY_RESERVED"
  | "RESERVATION_FAILED"
  | "PARTIALLY_RESERVED"
  | "PENDING_FINANCE_REVIEW"
  | "FINANCE_APPROVED"
  | "FINANCE_REJECTED"
  | "RETURNED_TO_REP_BY_FINANCE"
  | "PENDING_OPERATIONS_REVIEW"
  | "OPERATIONS_APPROVED"
  | "OPERATIONS_REJECTED"
  | "RETURNED_TO_FINANCE"
  | "RETURNED_TO_REP_BY_OPERATIONS"
  | "PENDING_STORE_PREPARATION"
  | "STORE_PREPARING"
  | "READY_FOR_DISPATCH"
  | "STORE_REJECTED"
  | "ASSIGNED_FOR_DELIVERY"
  | "RELEASED_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "PARTIALLY_DELIVERED"
  | "DELIVERED"
  | "DELIVERY_ATTEMPTED"
  | "DELIVERY_POSTPONED"
  | "DELIVERY_FAILED"
  | "CUSTOMER_REFUSED"
  | "RETURNED"
  | "RETURNED_TO_STORE"
  | "CANCELLED"
  | "EXPIRED"
  | "CLOSED";

export type OrderCapability =
  | "ORDER_CREATE"
  | "ORDER_SUBMIT"
  | "ORDER_VIEW_OWN"
  | "ORDER_VIEW_TEAM"
  | "ORDER_VIEW_SCOPED"
  | "ORDER_VIEW_STORE_QUEUE"
  | "ORDER_FINANCE_REVIEW"
  | "ORDER_FINANCE_APPROVE"
  | "ORDER_FINANCE_REJECT"
  | "ORDER_FINANCE_RETURN"
  | "ORDER_OPERATIONS_REVIEW"
  | "ORDER_OPERATIONS_APPROVE"
  | "ORDER_OPERATIONS_REJECT"
  | "ORDER_OPERATIONS_RETURN"
  | "ORDER_STORE_PREPARE"
  | "ORDER_STORE_READY"
  | "ORDER_START_PREPARATION"
  | "ORDER_MARK_PACKED"
  | "ORDER_RELEASE_TO_DELIVERY"
  | "ORDER_RETURN_TO_OPERATIONS"
  | "ORDER_CANCEL"
  | "ORDER_DELIVERY_ASSIGN"
  | "ORDER_DELIVERY_EXECUTE"
  | "ORDER_DELIVERY_COMPLETE"
  | "ORDER_DELIVERY_RETURN"
  | "ORDER_DELIVERY_CANCEL"
  | "ORDER_ADMIN_OVERRIDE";

export interface OrderTransitionHistory {
  transitionId: string;
  orderId: string;
  orderDisplayNumber: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  fromStage: OrderStage;
  toStage: OrderStage;
  action: string;
  actorUid: string;
  actorName: string;
  actorGeneralRole: string;
  orderCapabilityUsed: OrderCapability | string;
  comments?: string;
  reasonCode?: string;
  createdAt: string;
  deviceSessionId?: string;
  source: "WEB" | "MOBILE" | "BACKEND" | "ADMIN_OVERRIDE";
}

export interface SegregationCheckResult {
  orderId: string;
  creatorUid: string;
  actorUid: string;
  requestedAction: string;
  allowed: boolean;
  reason: string;
}

export interface TransitionCheckResult {
  allowed: boolean;
  nextStatus: OrderStatus | null;
  nextStage: OrderStage | null;
  reasonCode: string;
  reasonMessage: string;
  capabilityUsed?: OrderCapability;
  segregationCheck?: SegregationCheckResult;
}

/**
 * Normalizes legacy string status into canonical OrderStatus
 */
export function normalizeOrderStatus(legacyStatus: string | undefined | null): OrderStatus {
  if (!legacyStatus) return "DRAFT";
  const upper = legacyStatus.trim().toUpperCase();

  const canonicalStatuses: OrderStatus[] = [
    "DRAFT", "SUBMITTED", "RESERVATION_PENDING", "INVENTORY_RESERVED",
    "RESERVATION_FAILED", "PARTIALLY_RESERVED", "PENDING_FINANCE_REVIEW",
    "FINANCE_APPROVED", "FINANCE_REJECTED", "RETURNED_TO_REP_BY_FINANCE",
    "PENDING_OPERATIONS_REVIEW", "OPERATIONS_APPROVED", "OPERATIONS_REJECTED",
    "RETURNED_TO_FINANCE", "RETURNED_TO_REP_BY_OPERATIONS",
    "PENDING_STORE_PREPARATION", "STORE_PREPARING", "READY_FOR_DISPATCH",
    "STORE_REJECTED", "ASSIGNED_FOR_DELIVERY", "OUT_FOR_DELIVERY",
    "PARTIALLY_DELIVERED", "DELIVERED", "DELIVERY_FAILED", "CUSTOMER_REFUSED",
    "RETURNED", "CANCELLED", "EXPIRED", "CLOSED"
  ];

  if (canonicalStatuses.includes(upper as OrderStatus)) {
    return upper as OrderStatus;
  }

  // Mappings from legacy UI titles
  if (upper.includes("SUPERVISOR") || upper.includes("FINANCIAL") || upper.includes("FINANCE")) {
    if (upper.includes("RETURNED")) return "RETURNED_TO_REP_BY_FINANCE";
    return "PENDING_FINANCE_REVIEW";
  }
  if (upper.includes("OPS") || upper.includes("OPERATIONS")) {
    if (upper.includes("RETURNED")) return "RETURNED_TO_REP_BY_OPERATIONS";
    return "PENDING_OPERATIONS_REVIEW";
  }
  if (upper.includes("STORE")) {
    return "PENDING_STORE_PREPARATION";
  }
  if (upper.includes("DELIVERY")) {
    if (upper.includes("IN DELIVERY") || upper.includes("OUT_FOR_DELIVERY")) return "OUT_FOR_DELIVERY";
    return "ASSIGNED_FOR_DELIVERY";
  }
  if (upper === "DELIVERED") return "DELIVERED";
  if (upper === "VOIDED" || upper === "CANCELLED" || upper === "REJECTED") return "CANCELLED";
  if (upper === "APPROVED" || upper === "ORDER_APPROVED") return "OPERATIONS_APPROVED";
  if (upper === "SUBMITTED" || upper === "NEW" || upper === "ORDER PLACED") return "SUBMITTED";

  return "SUBMITTED";
}

/**
 * Gets the corresponding OrderStage for a given OrderStatus
 */
export function getStageForStatus(status: OrderStatus): OrderStage {
  switch (status) {
    case "DRAFT":
      return "DRAFT";
    case "SUBMITTED":
      return "SUBMISSION";
    case "RESERVATION_PENDING":
    case "INVENTORY_RESERVED":
    case "RESERVATION_FAILED":
    case "PARTIALLY_RESERVED":
      return "INVENTORY_RESERVATION";
    case "PENDING_FINANCE_REVIEW":
    case "FINANCE_APPROVED":
    case "FINANCE_REJECTED":
    case "RETURNED_TO_REP_BY_FINANCE":
      return "FINANCE_REVIEW";
    case "PENDING_OPERATIONS_REVIEW":
    case "OPERATIONS_REJECTED":
    case "RETURNED_TO_FINANCE":
    case "RETURNED_TO_REP_BY_OPERATIONS":
      return "OPERATIONS_REVIEW";
    case "OPERATIONS_APPROVED":
    case "PENDING_STORE_PREPARATION":
    case "STORE_PREPARING":
    case "STORE_REJECTED":
      return "STORE_PREPARATION";
    case "READY_FOR_DISPATCH":
      return "DISPATCH";
    case "ASSIGNED_FOR_DELIVERY":
    case "OUT_FOR_DELIVERY":
    case "PARTIALLY_DELIVERED":
    case "DELIVERY_FAILED":
    case "CUSTOMER_REFUSED":
    case "RETURNED":
      return "DELIVERY";
    case "DELIVERED":
    case "CANCELLED":
    case "EXPIRED":
    case "CLOSED":
      return "CLOSED";
    default:
      return "SUBMISSION";
  }
}

/**
 * Map user role to OrderCapabilities
 */
export function getCapabilitiesForRole(role: Role | string): OrderCapability[] {
  const normalized = normalizeRole(role);
  const caps: Set<OrderCapability> = new Set();

  if (
    normalized === Role.SUPER_ADMIN ||
    normalized === Role.ADMIN ||
    normalized === Role.SYSTEM_ADMINISTRATOR ||
    normalized === Role.GENERAL_MANAGER
  ) {
    caps.add("ORDER_ADMIN_OVERRIDE");
    caps.add("ORDER_CREATE");
    caps.add("ORDER_SUBMIT");
    caps.add("ORDER_VIEW_OWN");
    caps.add("ORDER_VIEW_TEAM");
    caps.add("ORDER_VIEW_SCOPED");
    caps.add("ORDER_FINANCE_REVIEW");
    caps.add("ORDER_FINANCE_APPROVE");
    caps.add("ORDER_FINANCE_REJECT");
    caps.add("ORDER_FINANCE_RETURN");
    caps.add("ORDER_OPERATIONS_REVIEW");
    caps.add("ORDER_OPERATIONS_APPROVE");
    caps.add("ORDER_OPERATIONS_REJECT");
    caps.add("ORDER_OPERATIONS_RETURN");
    caps.add("ORDER_STORE_PREPARE");
    caps.add("ORDER_STORE_READY");
    caps.add("ORDER_DELIVERY_ASSIGN");
    caps.add("ORDER_DELIVERY_EXECUTE");
    caps.add("ORDER_DELIVERY_COMPLETE");
    caps.add("ORDER_DELIVERY_RETURN");
    caps.add("ORDER_DELIVERY_CANCEL");
    return Array.from(caps);
  }

  if (normalized === Role.SALES_REP || normalized === Role.MEDICAL_REP) {
    caps.add("ORDER_CREATE");
    caps.add("ORDER_SUBMIT");
    caps.add("ORDER_VIEW_OWN");
  }

  if (
    normalized === Role.FINANCE ||
    normalized === Role.FINANCE_MANAGER ||
    normalized === Role.TREASURY_OFFICER
  ) {
    caps.add("ORDER_FINANCE_REVIEW");
    caps.add("ORDER_FINANCE_APPROVE");
    caps.add("ORDER_FINANCE_REJECT");
    caps.add("ORDER_FINANCE_RETURN");
    caps.add("ORDER_VIEW_SCOPED");
  }

  if (
    normalized === Role.ORDER_OPS_OFFICER ||
    normalized === Role.SALES_MANAGER ||
    normalized === Role.SALES_SUPERVISOR ||
    normalized === Role.AREA_SALES_MANAGER ||
    normalized === Role.SALES_MARKETING_MANAGER
  ) {
    caps.add("ORDER_OPERATIONS_REVIEW");
    caps.add("ORDER_OPERATIONS_APPROVE");
    caps.add("ORDER_OPERATIONS_REJECT");
    caps.add("ORDER_OPERATIONS_RETURN");
    caps.add("ORDER_VIEW_TEAM");
  }

  if (
    normalized === Role.STORE_MANAGER ||
    normalized === Role.WAREHOUSE_MANAGER ||
    normalized === Role.INVENTORY_OFFICER
  ) {
    caps.add("ORDER_STORE_PREPARE");
    caps.add("ORDER_STORE_READY");
    caps.add("ORDER_DELIVERY_ASSIGN");
    caps.add("ORDER_VIEW_SCOPED");
    caps.add("ORDER_VIEW_STORE_QUEUE");
    caps.add("ORDER_START_PREPARATION");
    caps.add("ORDER_MARK_PACKED");
    caps.add("ORDER_RELEASE_TO_DELIVERY");
    caps.add("ORDER_RETURN_TO_OPERATIONS");
    caps.add("ORDER_CANCEL");
  }

  if (normalized === Role.DELIVERY_OFFICER) {
    caps.add("ORDER_DELIVERY_EXECUTE");
    caps.add("ORDER_DELIVERY_COMPLETE");
    caps.add("ORDER_DELIVERY_RETURN");
    caps.add("ORDER_VIEW_SCOPED");
  }

  return Array.from(caps);
}

/**
 * Verify Creator Segregation of Duties Rule
 * Permanent rule: Order creator may NOT perform any approval/validation/fulfillment actions on their own order.
 */
export function checkCreatorSegregation(
  order: { id: string; createdByUid?: string; salesRepUid?: string; createdBy?: string; salesRep?: string },
  actorUid: string,
  requestedAction: string
): SegregationCheckResult {
  const creatorUid = order.createdByUid || order.salesRepUid || order.createdBy || order.salesRep || "";
  
  const approvalActions = [
    "APPROVE_FINANCE",
    "FINANCE_APPROVE",
    "FINANCE_REJECT",
    "FINANCE_RETURN",
    "OPERATIONS_APPROVE",
    "OPERATIONS_REJECT",
    "OPERATIONS_RETURN_TO_FINANCE",
    "OPERATIONS_RETURN_TO_REP",
    "STORE_START_PREPARE",
    "STORE_MARK_READY",
    "STORE_REJECT",
    "DELIVERY_COMPLETE",
    "DELIVERY_PARTIAL",
    "DELIVERY_REFUSE",
    "DELIVERY_FAIL",
    "DELIVERY_RETURN"
  ];

  const isApprovalAction = approvalActions.includes(requestedAction);

  if (isApprovalAction && actorUid && creatorUid && actorUid === creatorUid) {
    return {
      orderId: order.id,
      creatorUid,
      actorUid,
      requestedAction,
      allowed: false,
      reason: "SEGREGATION_OF_DUTIES_VIOLATION: Order creator cannot perform approval or validation stage actions on their own order."
    };
  }

  return {
    orderId: order.id,
    creatorUid,
    actorUid,
    requestedAction,
    allowed: true,
    reason: "Segregation check passed."
  };
}

/**
 * Central State Machine Transition Engine
 */
export function canTransitionOrder(params: {
  order: any;
  action: string;
  actor: { uid: string; role: Role | string; name?: string };
  orderPermissions?: OrderCapability[];
  comments?: string;
}): TransitionCheckResult {
  const { order, action, actor, comments } = params;
  const userCaps = params.orderPermissions || getCapabilitiesForRole(actor.role);
  const currentStatus = normalizeOrderStatus(order.status);
  const actorUid = actor.uid;
  const inventoryContract = classifyInventoryContract(order);

  if (inventoryContract.kind === "INTEGRITY_ERROR" && (action.startsWith("DELIVERY_") || ["FINANCE_REJECT", "STORE_REJECT", "CANCEL"].includes(action))) {
    return {
      allowed: false,
      nextStatus: null,
      nextStage: null,
      reasonCode: INVENTORY_CONTRACT_INTEGRITY_ERROR,
      reasonMessage: "Reservation-backed order inventory contract metadata is missing, malformed, or conflicting."
    };
  }

  // 1. Segregation check
  const segCheck = checkCreatorSegregation(order, actorUid, action);
  if (!segCheck.allowed) {
    return {
      allowed: false,
      nextStatus: null,
      nextStage: null,
      reasonCode: "SEGREGATION_OF_DUTIES_VIOLATION",
      reasonMessage: segCheck.reason,
      segregationCheck: segCheck
    };
  }

  // Helper check for capability
  const hasCap = (cap: OrderCapability) => userCaps.includes(cap) || userCaps.includes("ORDER_ADMIN_OVERRIDE");

  switch (action) {
    case "SUBMIT": {
      if (currentStatus !== "DRAFT") {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot submit order from status ${currentStatus}. Must be DRAFT.`
        };
      }
      if (!hasCap("ORDER_SUBMIT") && !hasCap("ORDER_CREATE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_SUBMIT to submit order."
        };
      }
      return {
        allowed: true,
        nextStatus: "SUBMITTED",
        nextStage: "SUBMISSION",
        reasonCode: "OK",
        reasonMessage: "Order submitted successfully.",
        capabilityUsed: "ORDER_SUBMIT",
        segregationCheck: segCheck
      };
    }

    case "RESERVE_STOCK": {
      if (currentStatus !== "SUBMITTED" && currentStatus !== "RESERVATION_PENDING") {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot transition stock reservation from status ${currentStatus}.`
        };
      }
      return {
        allowed: true,
        nextStatus: "INVENTORY_RESERVED",
        nextStage: "INVENTORY_RESERVATION",
        reasonCode: "OK",
        reasonMessage: "Stock reserved. Ready for finance review.",
        capabilityUsed: "ORDER_SUBMIT",
        segregationCheck: segCheck
      };
    }

    case "APPROVE_FINANCE":
    case "FINANCE_APPROVE": {
      if (
        currentStatus !== "PENDING_FINANCE_REVIEW" &&
        currentStatus !== "INVENTORY_RESERVED" &&
        currentStatus !== "RETURNED_TO_FINANCE"
      ) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot perform Finance Approval from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_FINANCE_APPROVE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_FINANCE_APPROVE."
        };
      }
      return {
        allowed: true,
        nextStatus: "FINANCE_APPROVED",
        nextStage: "FINANCE_REVIEW",
        reasonCode: "OK",
        reasonMessage: "Finance approval granted. Next: Operations Review.",
        capabilityUsed: "ORDER_FINANCE_APPROVE",
        segregationCheck: segCheck
      };
    }

    case "FINANCE_REJECT": {
      if (
        currentStatus !== "PENDING_FINANCE_REVIEW" &&
        currentStatus !== "INVENTORY_RESERVED" &&
        currentStatus !== "RETURNED_TO_FINANCE"
      ) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot perform Finance Rejection from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_FINANCE_REJECT")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_FINANCE_REJECT."
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Rejection requires an explicit reason or comment."
        };
      }
      return {
        allowed: true,
        nextStatus: "FINANCE_REJECTED",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Order rejected by Finance.",
        capabilityUsed: "ORDER_FINANCE_REJECT",
        segregationCheck: segCheck
      };
    }

    case "FINANCE_RETURN": {
      if (
        currentStatus !== "PENDING_FINANCE_REVIEW" &&
        currentStatus !== "INVENTORY_RESERVED" &&
        currentStatus !== "RETURNED_TO_FINANCE"
      ) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot return order from Finance at status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_FINANCE_RETURN")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_FINANCE_RETURN."
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Returning order requires an explicit comment or instruction."
        };
      }
      return {
        allowed: true,
        nextStatus: "RETURNED_TO_REP_BY_FINANCE",
        nextStage: "FINANCE_REVIEW",
        reasonCode: "OK",
        reasonMessage: "Order returned to representative by Finance.",
        capabilityUsed: "ORDER_FINANCE_RETURN",
        segregationCheck: segCheck
      };
    }

    case "OPERATIONS_APPROVE": {
      if (currentStatus !== "PENDING_OPERATIONS_REVIEW" && currentStatus !== "FINANCE_APPROVED") {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot perform Operations Approval from status ${currentStatus}. Must be FINANCE_APPROVED or PENDING_OPERATIONS_REVIEW.`
        };
      }
      if (!hasCap("ORDER_OPERATIONS_APPROVE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_OPERATIONS_APPROVE."
        };
      }
      return {
        allowed: true,
        nextStatus: "OPERATIONS_APPROVED",
        nextStage: "OPERATIONS_REVIEW",
        reasonCode: "OK",
        reasonMessage: "Operations approval granted. Next: Store Preparation.",
        capabilityUsed: "ORDER_OPERATIONS_APPROVE",
        segregationCheck: segCheck
      };
    }

    case "OPERATIONS_REJECT": {
      if (currentStatus !== "PENDING_OPERATIONS_REVIEW" && currentStatus !== "FINANCE_APPROVED") {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot perform Operations Rejection from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_OPERATIONS_REJECT")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_OPERATIONS_REJECT."
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Rejection requires an explicit reason or comment."
        };
      }
      return {
        allowed: true,
        nextStatus: "OPERATIONS_REJECTED",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Order rejected by Order Operations.",
        capabilityUsed: "ORDER_OPERATIONS_REJECT",
        segregationCheck: segCheck
      };
    }

    case "OPERATIONS_RETURN_TO_FINANCE": {
      if (currentStatus !== "PENDING_OPERATIONS_REVIEW" && currentStatus !== "FINANCE_APPROVED") {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot return order to Finance from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_OPERATIONS_RETURN")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_OPERATIONS_RETURN."
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Returning order requires an explicit comment."
        };
      }
      return {
        allowed: true,
        nextStatus: "RETURNED_TO_FINANCE",
        nextStage: "FINANCE_REVIEW",
        reasonCode: "OK",
        reasonMessage: "Order returned to Finance Officer by Operations.",
        capabilityUsed: "ORDER_OPERATIONS_RETURN",
        segregationCheck: segCheck
      };
    }

    case "OPERATIONS_RETURN_TO_REP": {
      if (currentStatus !== "PENDING_OPERATIONS_REVIEW" && currentStatus !== "FINANCE_APPROVED") {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot return order to Rep from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_OPERATIONS_RETURN")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_OPERATIONS_RETURN."
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Returning order requires an explicit comment."
        };
      }
      return {
        allowed: true,
        nextStatus: "RETURNED_TO_REP_BY_OPERATIONS",
        nextStage: "OPERATIONS_REVIEW",
        reasonCode: "OK",
        reasonMessage: "Order returned to Sales Representative by Operations.",
        capabilityUsed: "ORDER_OPERATIONS_RETURN",
        segregationCheck: segCheck
      };
    }

    case "STORE_START_PREPARE": {
      if (
        currentStatus !== "OPERATIONS_APPROVED" &&
        currentStatus !== "PENDING_STORE_PREPARATION"
      ) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot start Store Preparation from status ${currentStatus}. Must be OPERATIONS_APPROVED.`
        };
      }
      if (!hasCap("ORDER_STORE_PREPARE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_STORE_PREPARE."
        };
      }
      return {
        allowed: true,
        nextStatus: "STORE_PREPARING",
        nextStage: "STORE_PREPARATION",
        reasonCode: "OK",
        reasonMessage: "Store Manager began order preparation.",
        capabilityUsed: "ORDER_STORE_PREPARE",
        segregationCheck: segCheck
      };
    }

    case "STORE_MARK_READY": {
      if (
        currentStatus !== "STORE_PREPARING" &&
        currentStatus !== "PENDING_STORE_PREPARATION" &&
        currentStatus !== "OPERATIONS_APPROVED"
      ) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot mark Ready for Dispatch from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_STORE_READY") && !hasCap("ORDER_STORE_PREPARE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_STORE_READY."
        };
      }
      return {
        allowed: true,
        nextStatus: "READY_FOR_DISPATCH",
        nextStage: "DISPATCH",
        reasonCode: "OK",
        reasonMessage: "Order prepared and marked Ready for Dispatch.",
        capabilityUsed: "ORDER_STORE_READY",
        segregationCheck: segCheck
      };
    }

    case "STORE_REJECT": {
      if (
        currentStatus !== "PENDING_STORE_PREPARATION" &&
        currentStatus !== "STORE_PREPARING" &&
        currentStatus !== "OPERATIONS_APPROVED"
      ) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot reject order in store from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_STORE_PREPARE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_STORE_PREPARE."
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Rejection requires an explicit reason or comment."
        };
      }
      return {
        allowed: true,
        nextStatus: "STORE_REJECTED",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Order rejected by Store Manager.",
        capabilityUsed: "ORDER_STORE_PREPARE",
        segregationCheck: segCheck
      };
    }

    case "STORE_RETURN_TO_OPS":
    case "RETURN_TO_OPERATIONS": {
      if (
        currentStatus !== "PENDING_STORE_PREPARATION" &&
        currentStatus !== "STORE_PREPARING" &&
        currentStatus !== "OPERATIONS_APPROVED"
      ) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot return order to Operations from status ${currentStatus}.`
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Returning order requires an explicit comment."
        };
      }
      return {
        allowed: true,
        nextStatus: "PENDING_OPERATIONS_REVIEW",
        nextStage: "OPERATIONS_REVIEW",
        reasonCode: "OK",
        reasonMessage: "Order returned to Order Operations Officer by Store Manager.",
        capabilityUsed: "ORDER_RETURN_TO_OPERATIONS",
        segregationCheck: segCheck
      };
    }

    case "DELIVERY_ASSIGN": {
      if (
        currentStatus !== "READY_FOR_DISPATCH" &&
        currentStatus !== "STORE_PREPARING" &&
        currentStatus !== "PENDING_STORE_PREPARATION" &&
        currentStatus !== "OPERATIONS_APPROVED"
      ) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot assign delivery from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_DELIVERY_ASSIGN") && !hasCap("ORDER_STORE_PREPARE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_DELIVERY_ASSIGN."
        };
      }
      return {
        allowed: true,
        nextStatus: "ASSIGNED_FOR_DELIVERY",
        nextStage: "DELIVERY",
        reasonCode: "OK",
        reasonMessage: "Order assigned to Delivery Officer.",
        capabilityUsed: "ORDER_DELIVERY_ASSIGN",
        segregationCheck: segCheck
      };
    }

    case "DELIVERY_START": {
      if (currentStatus !== "ASSIGNED_FOR_DELIVERY" && currentStatus !== "READY_FOR_DISPATCH") {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot mark Out for Delivery from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_DELIVERY_EXECUTE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_DELIVERY_EXECUTE."
        };
      }
      if (inventoryContract.version2 && String(order.deliveryOfficerUid || "").trim() !== String(actor.uid || "").trim()) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "DELIVERY_ASSIGNMENT_DENIED",
          reasonMessage: "Only the canonically assigned Delivery Officer may start delivery."
        };
      }
      return {
        allowed: true,
        nextStatus: "OUT_FOR_DELIVERY",
        nextStage: "DELIVERY",
        reasonCode: "OK",
        reasonMessage: "Order is out for delivery.",
        capabilityUsed: "ORDER_DELIVERY_EXECUTE",
        segregationCheck: segCheck
      };
    }

    case "DELIVERY_COMPLETE": {
      const validDelivStatus = inventoryContract.version2 ? ["OUT_FOR_DELIVERY"] : [
        "OUT_FOR_DELIVERY", "ASSIGNED_FOR_DELIVERY", "READY_FOR_DISPATCH", 
        "RELEASED_FOR_DELIVERY", "PREPARATION_COMPLETE", "STORE_PREPARATION_COMPLETED", "DISPATCH"
      ];
      if (!validDelivStatus.includes(currentStatus)) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot mark Delivered from status ${currentStatus}.`
        };
      }
      if (!hasCap("ORDER_DELIVERY_COMPLETE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_DELIVERY_COMPLETE."
        };
      }
      return {
        allowed: true,
        nextStatus: "DELIVERED",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Order delivered successfully and closed.",
        capabilityUsed: "ORDER_DELIVERY_COMPLETE",
        segregationCheck: segCheck
      };
    }

    case "DELIVERY_PARTIAL": {
      if (inventoryContract.version2) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "VERSION2_PARTIAL_DELIVERY_PROHIBITED",
          reasonMessage: "Version-2 orders require complete-invoice delivery outcomes."
        };
      }
      const validDelivStatus = [
        "OUT_FOR_DELIVERY", "ASSIGNED_FOR_DELIVERY", "READY_FOR_DISPATCH", 
        "RELEASED_FOR_DELIVERY", "PREPARATION_COMPLETE", "STORE_PREPARATION_COMPLETED", "DISPATCH"
      ];
      if (!validDelivStatus.includes(currentStatus)) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot mark Partially Delivered from status ${currentStatus}.`
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Partial delivery requires notes on delivered vs missing items."
        };
      }
      return {
        allowed: true,
        nextStatus: "PARTIALLY_DELIVERED",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Order partially delivered.",
        capabilityUsed: "ORDER_DELIVERY_COMPLETE",
        segregationCheck: segCheck
      };
    }

    case "DELIVERY_ATTEMPTED": {
      const validDelivStatus = inventoryContract.version2 ? ["OUT_FOR_DELIVERY"] : [
        "OUT_FOR_DELIVERY", "ASSIGNED_FOR_DELIVERY", "READY_FOR_DISPATCH", 
        "RELEASED_FOR_DELIVERY", "PREPARATION_COMPLETE", "STORE_PREPARATION_COMPLETED", "DISPATCH"
      ];
      if (!validDelivStatus.includes(currentStatus)) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot mark Delivery Attempted from status ${currentStatus}.`
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Delivery attempted requires documented notes."
        };
      }
      return {
        allowed: true,
        nextStatus: "DELIVERY_ATTEMPTED",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Delivery attempted (customer not available).",
        capabilityUsed: "ORDER_DELIVERY_EXECUTE",
        segregationCheck: segCheck
      };
    }

    case "DELIVERY_REFUSE": {
      const validDelivStatus = inventoryContract.version2 ? ["OUT_FOR_DELIVERY"] : [
        "OUT_FOR_DELIVERY", "ASSIGNED_FOR_DELIVERY", "READY_FOR_DISPATCH", 
        "RELEASED_FOR_DELIVERY", "PREPARATION_COMPLETE", "STORE_PREPARATION_COMPLETED", "DISPATCH"
      ];
      if (!validDelivStatus.includes(currentStatus)) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot mark Customer Refused from status ${currentStatus}.`
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Customer refusal requires documented notes."
        };
      }
      return {
        allowed: true,
        nextStatus: "CUSTOMER_REFUSED",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Customer refused delivery.",
        capabilityUsed: "ORDER_DELIVERY_CANCEL",
        segregationCheck: segCheck
      };
    }

    case "DELIVERY_FAIL": {
      const validDelivStatus = inventoryContract.version2 ? ["OUT_FOR_DELIVERY"] : [
        "OUT_FOR_DELIVERY", "ASSIGNED_FOR_DELIVERY", "READY_FOR_DISPATCH", 
        "RELEASED_FOR_DELIVERY", "PREPARATION_COMPLETE", "STORE_PREPARATION_COMPLETED", "DISPATCH"
      ];
      if (!validDelivStatus.includes(currentStatus)) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot mark Delivery Failed from status ${currentStatus}.`
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Failed delivery requires a documented reason."
        };
      }
      return {
        allowed: true,
        nextStatus: "DELIVERY_FAILED",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Delivery attempt failed.",
        capabilityUsed: "ORDER_DELIVERY_CANCEL",
        segregationCheck: segCheck
      };
    }

    case "DELIVERY_RETURN": {
      const validDelivStatus = inventoryContract.version2
        ? ["OUT_FOR_DELIVERY", "DELIVERY_FAILED", "CUSTOMER_REFUSED"]
        : [
        "OUT_FOR_DELIVERY", "ASSIGNED_FOR_DELIVERY", "READY_FOR_DISPATCH", 
        "RELEASED_FOR_DELIVERY", "PREPARATION_COMPLETE", "STORE_PREPARATION_COMPLETED", "DISPATCH", "CUSTOMER_REFUSED", "DELIVERY_FAILED"
      ];
      if (!validDelivStatus.includes(currentStatus)) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot mark Returned from status ${currentStatus}.`
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Return to store requires documented notes."
        };
      }
      return {
        allowed: true,
        nextStatus: "RETURNED_TO_STORE",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Order returned to warehouse / store.",
        capabilityUsed: "ORDER_DELIVERY_RETURN",
        segregationCheck: segCheck
      };
    }

    case "DELIVERY_POSTPONE": {
      const validDelivStatus = inventoryContract.version2 ? ["OUT_FOR_DELIVERY"] : [
        "OUT_FOR_DELIVERY", "ASSIGNED_FOR_DELIVERY", "READY_FOR_DISPATCH", 
        "RELEASED_FOR_DELIVERY", "PREPARATION_COMPLETE", "STORE_PREPARATION_COMPLETED", "DISPATCH"
      ];
      if (!validDelivStatus.includes(currentStatus)) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot postpone delivery from status ${currentStatus}.`
        };
      }
      return {
        allowed: true,
        nextStatus: "DELIVERY_POSTPONED",
        nextStage: "DELIVERY",
        reasonCode: "OK",
        reasonMessage: "Delivery postponed.",
        capabilityUsed: "ORDER_DELIVERY_EXECUTE",
        segregationCheck: segCheck
      };
    }

    case "CANCEL": {
      if (inventoryContract.version2 && ["OUT_FOR_DELIVERY", "DELIVERY_FAILED", "CUSTOMER_REFUSED", "RETURNED", "DELIVERED"].includes(currentStatus)) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "VERSION2_POST_DISPATCH_CANCELLATION_PROHIBITED",
          reasonMessage: "Version-2 orders cannot be cancelled after dispatch."
        };
      }
      if (currentStatus === "DELIVERED" || currentStatus === "CANCELLED" || currentStatus === "CLOSED") {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot cancel order in status ${currentStatus}.`
        };
      }
      if (!comments || comments.trim().length === 0) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "COMMENT_REQUIRED",
          reasonMessage: "Cancellation requires a documented reason."
        };
      }
      return {
        allowed: true,
        nextStatus: "CANCELLED",
        nextStage: "CLOSED",
        reasonCode: "OK",
        reasonMessage: "Order cancelled.",
        capabilityUsed: userCaps.includes("ORDER_ADMIN_OVERRIDE") ? "ORDER_ADMIN_OVERRIDE" : "ORDER_SUBMIT",
        segregationCheck: segCheck
      };
    }

    case "RESUBMIT_REVISED": {
      if (
        currentStatus !== "RETURNED_TO_REP_BY_FINANCE" &&
        currentStatus !== "RETURNED_TO_REP_BY_OPERATIONS"
      ) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "INVALID_CURRENT_STATUS",
          reasonMessage: `Cannot resubmit order from status ${currentStatus}. Must be RETURNED_TO_REP.`
        };
      }
      if (!hasCap("ORDER_SUBMIT") && !hasCap("ORDER_CREATE")) {
        return {
          allowed: false,
          nextStatus: null,
          nextStage: null,
          reasonCode: "MISSING_CAPABILITY",
          reasonMessage: "Missing capability ORDER_SUBMIT to resubmit order."
        };
      }
      return {
        allowed: true,
        nextStatus: "PENDING_FINANCE_REVIEW",
        nextStage: "FINANCE_REVIEW",
        reasonCode: "OK",
        reasonMessage: "Revised order resubmitted for Finance review.",
        capabilityUsed: "ORDER_SUBMIT",
        segregationCheck: segCheck
      };
    }

    default:
      return {
        allowed: false,
        nextStatus: null,
        nextStage: null,
        reasonCode: "UNKNOWN_ACTION",
        reasonMessage: `Unknown transition action: ${action}`
      };
  }
}

/**
 * Applies transition and returns updated order fields and transition history entry
 */
export function applyOrderTransition(params: {
  order: any;
  action: string;
  actor: { uid: string; role: Role | string; name?: string; email?: string };
  comments?: string;
  metadata?: any;
  deliveryAssignment?: any;
  orderPermissions?: OrderCapability[];
  source?: "WEB" | "MOBILE" | "BACKEND" | "ADMIN_OVERRIDE";
}): {
  success: boolean;
  updatedOrder: any;
  historyEntry: OrderTransitionHistory | null;
  error?: string;
  reasonCode?: string;
} {
  const check = canTransitionOrder(params);
  if (!check.allowed || !check.nextStatus) {
    return {
      success: false,
      updatedOrder: params.order,
      historyEntry: null,
      error: check.reasonMessage,
      reasonCode: check.reasonCode
    };
  }

  const order = params.order;
  const fromStatus = normalizeOrderStatus(order.status);
  const toStatus = check.nextStatus;
  const fromStage = getStageForStatus(fromStatus);
  const toStage = getStageForStatus(toStatus);
  const now = new Date().toISOString();

  const historyEntry: OrderTransitionHistory = {
    transitionId: `TR_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    orderId: order.id,
    orderDisplayNumber: order.displayNumber || order.id,
    fromStatus,
    toStatus,
    fromStage,
    toStage,
    action: params.action,
    actorUid: params.actor.uid,
    actorName: params.actor.name || "System",
    actorGeneralRole: String(params.actor.role),
    orderCapabilityUsed: check.capabilityUsed || "UNKNOWN",
    comments: params.comments || "",
    reasonCode: check.reasonCode,
    createdAt: now,
    source: params.source || "WEB"
  };

  const updatedHistory = Array.isArray(order.history) ? [...order.history, historyEntry] : [historyEntry];

  const updatedOrder = {
    ...order,
    status: toStatus,
    stage: toStage,
    updatedAt: now,
    history: updatedHistory
  };

  // Populate stage audit timestamps
  if (toStatus === "SUBMITTED") {
    updatedOrder.submittedAt = updatedOrder.submittedAt || now;
    updatedOrder.submittedByUid = updatedOrder.submittedByUid || params.actor.uid;
    // Auto move to reservation pending
    updatedOrder.status = "RESERVATION_PENDING";
    updatedOrder.stage = "INVENTORY_RESERVATION";
    updatedOrder.reservationStatus = "PENDING";
  } else if (toStatus === "INVENTORY_RESERVED") {
    updatedOrder.reservationStatus = "RESERVED";
    updatedOrder.reservedAt = now;
    // Advance to Finance Review
    updatedOrder.status = "PENDING_FINANCE_REVIEW";
    updatedOrder.stage = "FINANCE_REVIEW";
  } else if (toStatus === "FINANCE_APPROVED") {
    updatedOrder.financeReviewedAt = now;
    updatedOrder.financeReviewedByUid = params.actor.uid;
    updatedOrder.financeDecision = "APPROVED";
    updatedOrder.financeApprovedAt = now;
    updatedOrder.financeApprovedByUid = params.actor.uid;
    updatedOrder.financeApprovedByName = params.actor.name || "Finance Officer";
    updatedOrder.financeApprovedByEmail = params.actor.email || "";
    updatedOrder.financeRemarks = params.comments || "";
    // Advance to Operations Review
    updatedOrder.status = "PENDING_OPERATIONS_REVIEW";
    updatedOrder.stage = "OPERATIONS_REVIEW";
    historyEntry.toStatus = "PENDING_OPERATIONS_REVIEW";
    historyEntry.toStage = "OPERATIONS_REVIEW";
  } else if (toStatus === "FINANCE_REJECTED") {
    updatedOrder.financeReviewedAt = now;
    updatedOrder.financeReviewedByUid = params.actor.uid;
    updatedOrder.rejectionReason = params.comments || "Finance Rejected";
    updatedOrder.stage = "CLOSED";
  } else if (toStatus === "OPERATIONS_APPROVED") {
    updatedOrder.operationsReviewedAt = now;
    updatedOrder.operationsReviewedByUid = params.actor.uid;
    updatedOrder.opsApprovedAt = now;
    updatedOrder.opsApprovedByUid = params.actor.uid;
    updatedOrder.opsApprovedByName = params.actor.name || "Order Operations Officer";
    updatedOrder.opsApprovedByEmail = params.actor.email || "";
    updatedOrder.opsRemarks = params.comments || "";
    // Advance to Store Preparation
    updatedOrder.status = "PENDING_STORE_PREPARATION";
    updatedOrder.stage = "STORE_PREPARATION";
  } else if (toStatus === "OPERATIONS_REJECTED") {
    updatedOrder.operationsReviewedAt = now;
    updatedOrder.operationsReviewedByUid = params.actor.uid;
    updatedOrder.rejectionReason = params.comments || "Operations Rejected";
    updatedOrder.stage = "CLOSED";
  } else if (toStatus === "STORE_PREPARING") {
    updatedOrder.storePreparedAt = now;
    updatedOrder.storePreparedByUid = params.actor.uid;
    updatedOrder.storeCompletedByName = params.actor.name || "Store Manager";
  } else if (toStatus === "READY_FOR_DISPATCH") {
    updatedOrder.storePreparedAt = updatedOrder.storePreparedAt || now;
    updatedOrder.storePreparedByUid = updatedOrder.storePreparedByUid || params.actor.uid;
    updatedOrder.storeCompletedByName = updatedOrder.storeCompletedByName || params.actor.name || "Store Manager";
    updatedOrder.storeCompletedByUid = updatedOrder.storePreparedByUid || params.actor.uid;
    updatedOrder.storeRemarks = params.comments || updatedOrder.storeRemarks || "";
    updatedOrder.inventoryVerified = true;
    updatedOrder.pickingStatus = "COMPLETED";
    updatedOrder.packingStatus = "COMPLETED";
    updatedOrder.stage = "DISPATCH";
  } else if (toStatus === "ASSIGNED_FOR_DELIVERY" || toStatus === "OUT_FOR_DELIVERY") {
    updatedOrder.deliveryAssignedAt = updatedOrder.deliveryAssignedAt || now;
    updatedOrder.deliveryAssignedByUid = updatedOrder.deliveryAssignedByUid || params.actor.uid;
    updatedOrder.deliveryOfficerUid = params.deliveryAssignment?.deliveryOfficerUid || params.metadata?.deliveryOfficerUid || params.metadata?.deliveryOfficerId || updatedOrder.deliveryOfficerUid;
    updatedOrder.deliveryOfficerName = params.deliveryAssignment?.deliveryOfficerName || params.metadata?.deliveryOfficerName || updatedOrder.deliveryOfficerName;
    updatedOrder.deliveryOfficerEmail = params.deliveryAssignment?.deliveryOfficerEmail || params.metadata?.deliveryOfficerEmail || updatedOrder.deliveryOfficerEmail;
    updatedOrder.deliveryAssignmentStatus = params.deliveryAssignment?.deliveryAssignmentStatus || params.metadata?.deliveryAssignmentStatus || (updatedOrder.deliveryOfficerUid ? "ASSIGNED" : "UNASSIGNED");
    if (params.deliveryAssignment?.plannedDeliveryDate || params.metadata?.plannedDeliveryDate) {
      updatedOrder.plannedDeliveryDate = params.deliveryAssignment?.plannedDeliveryDate || params.metadata?.plannedDeliveryDate;
    }
    if (params.deliveryAssignment?.plannedDeliveryWindow || params.metadata?.plannedDeliveryWindow || params.metadata?.plannedDeliveryTime || params.metadata?.deliveryWindow) {
      updatedOrder.plannedDeliveryWindow = params.deliveryAssignment?.plannedDeliveryWindow || params.metadata?.plannedDeliveryWindow || params.metadata?.plannedDeliveryTime || params.metadata?.deliveryWindow;
    }
    updatedOrder.deliveryStatus = toStatus;
    updatedOrder.stage = "DELIVERY";
    if (params.action === "DELIVERY_POSTPONE") {
      updatedOrder.postponedAt = now;
      updatedOrder.postponedByUid = params.actor.uid;
      updatedOrder.postponedBy = params.actor.name;
      updatedOrder.postponedReason = params.comments || params.metadata?.reason || "Postponed by Delivery Officer";
      if (params.metadata?.newDeliveryDate) {
        updatedOrder.newDeliveryDate = params.metadata.newDeliveryDate;
        updatedOrder.plannedDeliveryDate = params.metadata.newDeliveryDate;
      }
      updatedOrder.deliveryStatus = "POSTPONED";
      updatedOrder.deliveryOutcome = "POSTPONED";
      updatedOrder.deliveryOutcomeByUid = params.actor.uid;
      updatedOrder.deliveryOutcomeByName = params.actor.name || "Delivery Officer";
      updatedOrder.deliveryOutcomeAt = now;
      updatedOrder.deliveryOutcomeNotes = params.comments || "";
    }
  } else if (toStatus === "DELIVERED") {
    updatedOrder.deliveredAt = now;
    updatedOrder.deliveredByUid = params.actor.uid;
    updatedOrder.deliveredBy = params.actor.name;
    updatedOrder.deliveryOfficerUid = updatedOrder.deliveryOfficerUid || params.actor.uid;
    updatedOrder.deliveryOfficerName = updatedOrder.deliveryOfficerName || params.actor.name;
    if (params.metadata?.deliveryGPS) updatedOrder.deliveryGPS = params.metadata.deliveryGPS;
    if (params.metadata?.recipientName) updatedOrder.recipientName = params.metadata.recipientName;
    if (params.metadata?.deliverySignature) updatedOrder.deliverySignature = params.metadata.deliverySignature;
    if (params.metadata?.deliveryReceipt) updatedOrder.deliveryReceipt = params.metadata.deliveryReceipt;
    if (Array.isArray(params.metadata?.deliveryPhotos)) updatedOrder.deliveryPhotos = params.metadata.deliveryPhotos;
    if (params.metadata?.signatureUrl) updatedOrder.signatureUrl = params.metadata.signatureUrl;
    if (params.metadata?.photoUrl) updatedOrder.photoUrl = params.metadata.photoUrl;
    if (params.comments) updatedOrder.deliveryRemarks = params.comments;
    updatedOrder.deliveryStatus = "DELIVERED";
    updatedOrder.stage = "CLOSED";
    updatedOrder.deliveryOutcome = "DELIVERED";
    updatedOrder.deliveryOutcomeByUid = params.actor.uid;
    updatedOrder.deliveryOutcomeByName = params.actor.name || "Delivery Officer";
    updatedOrder.deliveryOutcomeAt = now;
    updatedOrder.deliveryOutcomeNotes = params.comments || "";
  } else if (toStatus === "RETURNED") {
    updatedOrder.returnedAt = now;
    updatedOrder.returnedByUid = params.actor.uid;
    updatedOrder.returnedBy = params.actor.name;
    updatedOrder.deliveryOfficerUid = updatedOrder.deliveryOfficerUid || params.actor.uid;
    updatedOrder.deliveryOfficerName = updatedOrder.deliveryOfficerName || params.actor.name;
    updatedOrder.returnReason = params.comments || params.metadata?.returnReason || "Returned to Warehouse";
    updatedOrder.returnStatus = "RETURNED";
    updatedOrder.inventoryReconciliationStatus = "PENDING_RECONCILIATION";
    updatedOrder.stage = "CLOSED";
    updatedOrder.deliveryOutcome = "RETURNED";
    updatedOrder.deliveryOutcomeByUid = params.actor.uid;
    updatedOrder.deliveryOutcomeByName = params.actor.name || "Delivery Officer";
    updatedOrder.deliveryOutcomeAt = now;
    updatedOrder.deliveryOutcomeNotes = params.comments || "";
  } else if (toStatus === "CUSTOMER_REFUSED") {
    updatedOrder.refusedAt = now;
    updatedOrder.refusedByUid = params.actor.uid;
    updatedOrder.deliveryOfficerUid = updatedOrder.deliveryOfficerUid || params.actor.uid;
    updatedOrder.deliveryOfficerName = updatedOrder.deliveryOfficerName || params.actor.name;
    updatedOrder.stage = "CLOSED";
    updatedOrder.deliveryOutcome = "CUSTOMER_REFUSED";
    updatedOrder.deliveryOutcomeByUid = params.actor.uid;
    updatedOrder.deliveryOutcomeByName = params.actor.name || "Delivery Officer";
    updatedOrder.deliveryOutcomeAt = now;
    updatedOrder.deliveryOutcomeNotes = params.comments || "";
  } else if (toStatus === "CANCELLED") {
    updatedOrder.cancellationReason = params.comments || "Cancelled";
    updatedOrder.stage = "CLOSED";
  }

  return {
    success: true,
    updatedOrder,
    historyEntry
  };
}

export interface OrderWorkflowPresentationInput {
  status?: string;
  stage?: string;
  action?: string;
  lang?: "en" | "ar";
}

export interface OrderWorkflowPresentationOutput {
  statusLabel: string;
  stageLabel: string;
  actionLabel: string;
  shortDescription: string;
}

/**
 * Shared Order workflow presentation resolver providing bilingual user-facing labels
 * for raw status enums, stage codes, and workflow actions.
 */
export function getOrderWorkflowPresentation(input: OrderWorkflowPresentationInput): OrderWorkflowPresentationOutput {
  const isAr = input.lang === "ar";
  const normStatus = input.status ? normalizeOrderStatus(input.status) : undefined;
  const stage = input.stage ? (input.stage as OrderStage) : (normStatus ? getStageForStatus(normStatus as OrderStatus) : undefined);

  let statusLabel = "";
  if (normStatus) {
    if (isAr) {
      switch (normStatus as string) {
        case "DRAFT": statusLabel = "مسودة"; break;
        case "PENDING_SUBMISSION": statusLabel = "بانتظار تقديم الطلب"; break;
        case "SUBMITTED": statusLabel = "تم تقديم الطلب للمراجعة"; break;
        case "PENDING_SUPERVISOR_APPROVAL": statusLabel = "بانتظار موافقة المشرف"; break;
        case "PENDING_FINANCE_REVIEW":
        case "INVENTORY_RESERVED": statusLabel = "بانتظار المراجعة المالية"; break;
        case "FINANCE_APPROVED":
        case "PENDING_OPERATIONS_REVIEW": statusLabel = "بانتظار مراجعة عمليات الطلبات"; break;
        case "OPERATIONS_APPROVED":
        case "PENDING_STORE_PREPARATION": statusLabel = "بانتظار تجهيز المخزن"; break;
        case "STORE_PREPARING": statusLabel = "جاري تجهيز الطلب بالمخزن"; break;
        case "READY_FOR_DISPATCH": statusLabel = "جاهز للتسليم والشحن"; break;
        case "ASSIGNED_FOR_DELIVERY": statusLabel = "تم التعيين لمسؤول التوصيل"; break;
        case "OUT_FOR_DELIVERY": statusLabel = "قيد التوصيل"; break;
        case "DELIVERED": statusLabel = "تم التسليم"; break;
        case "CLOSED": statusLabel = "تم التسليم والإغلاق"; break;
        case "RETURNED_TO_REP":
        case "RETURNED_TO_REP_BY_FINANCE":
        case "RETURNED_TO_REP_BY_OPERATIONS": statusLabel = "مُعاد إلى مندوب المبيعات"; break;
        case "RETURNED_TO_FINANCE":
        case "RETURNED_TO_FINANCE_BY_OPERATIONS": statusLabel = "مُعاد إلى القسم المالي"; break;
        case "FINANCE_REJECTED": statusLabel = "مرفوض من القسم المالي"; break;
        case "OPERATIONS_REJECTED": statusLabel = "مرفوض من عمليات الطلبات"; break;
        case "STORE_REJECTED": statusLabel = "مرفوض من المخزن"; break;
        case "DELIVERY_FAILED": statusLabel = "فشل التوصيل"; break;
        case "DELIVERY_ATTEMPTED": statusLabel = "محاولة توصيل (العميل غير متواجد)"; break;
        case "CUSTOMER_REFUSED": statusLabel = "رفض المستلم الشحنة"; break;
        case "PARTIALLY_DELIVERED": statusLabel = "تسليم جزئي"; break;
        case "RETURNED":
        case "RETURNED_TO_STORE": statusLabel = "تم الإرجاع للمخزن"; break;
        case "POSTPONED": statusLabel = "مؤجل موعد التسليم"; break;
        case "CANCELLED": statusLabel = "ملغى"; break;
        default: statusLabel = normStatus.replace(/_/g, " "); break;
      }
    } else {
      switch (normStatus as string) {
        case "DRAFT": statusLabel = "Draft"; break;
        case "PENDING_SUBMISSION": statusLabel = "Pending Submission"; break;
        case "SUBMITTED": statusLabel = "Submitted for Review"; break;
        case "PENDING_SUPERVISOR_APPROVAL": statusLabel = "Pending Supervisor Approval"; break;
        case "PENDING_FINANCE_REVIEW":
        case "INVENTORY_RESERVED": statusLabel = "Pending Financial Review"; break;
        case "FINANCE_APPROVED":
        case "PENDING_OPERATIONS_REVIEW": statusLabel = "Pending Operations Review"; break;
        case "OPERATIONS_APPROVED":
        case "PENDING_STORE_PREPARATION": statusLabel = "Pending Store Preparation"; break;
        case "STORE_PREPARING": statusLabel = "Store Preparation in Progress"; break;
        case "READY_FOR_DISPATCH": statusLabel = "Ready for Dispatch"; break;
        case "ASSIGNED_FOR_DELIVERY": statusLabel = "Assigned for Delivery"; break;
        case "OUT_FOR_DELIVERY": statusLabel = "Out for Delivery"; break;
        case "DELIVERED": statusLabel = "Delivered"; break;
        case "CLOSED": statusLabel = "Delivered & Closed"; break;
        case "RETURNED_TO_REP":
        case "RETURNED_TO_REP_BY_FINANCE":
        case "RETURNED_TO_REP_BY_OPERATIONS": statusLabel = "Returned to Sales Representative"; break;
        case "RETURNED_TO_FINANCE":
        case "RETURNED_TO_FINANCE_BY_OPERATIONS": statusLabel = "Returned to Finance"; break;
        case "FINANCE_REJECTED": statusLabel = "Rejected by Finance"; break;
        case "OPERATIONS_REJECTED": statusLabel = "Rejected by Operations"; break;
        case "STORE_REJECTED": statusLabel = "Rejected by Store"; break;
        case "DELIVERY_FAILED": statusLabel = "Delivery Failed"; break;
        case "DELIVERY_ATTEMPTED": statusLabel = "Delivery Attempted (Customer Not Available)"; break;
        case "CUSTOMER_REFUSED": statusLabel = "Customer Refused Delivery"; break;
        case "PARTIALLY_DELIVERED": statusLabel = "Partially Delivered"; break;
        case "RETURNED":
        case "RETURNED_TO_STORE": statusLabel = "Returned to Store"; break;
        case "POSTPONED": statusLabel = "Delivery Postponed"; break;
        case "CANCELLED": statusLabel = "Cancelled"; break;
        default: statusLabel = normStatus.replace(/_/g, " "); break;
      }
    }
  }

  let stageLabel = "";
  if (stage) {
    if (isAr) {
      switch (stage) {
        case "DRAFT": stageLabel = "مسودة"; break;
        case "SUBMISSION": stageLabel = "تقديم الطلب"; break;
        case "INVENTORY_RESERVATION": stageLabel = "حجز المخزون"; break;
        case "FINANCE_REVIEW": stageLabel = "المراجعة المالية"; break;
        case "OPERATIONS_REVIEW": stageLabel = "مراجعة العمليات"; break;
        case "STORE_PREPARATION": stageLabel = "تجهيز المخزن"; break;
        case "DISPATCH": stageLabel = "الشحن والتوصيل"; break;
        case "DELIVERY": stageLabel = "قيد التوصيل"; break;
        case "CLOSED": stageLabel = "مكتمل ومغلق"; break;
        default: stageLabel = stage; break;
      }
    } else {
      switch (stage) {
        case "DRAFT": stageLabel = "Draft"; break;
        case "SUBMISSION": stageLabel = "Order Submission"; break;
        case "INVENTORY_RESERVATION": stageLabel = "Inventory Reservation"; break;
        case "FINANCE_REVIEW": stageLabel = "Financial Review"; break;
        case "OPERATIONS_REVIEW": stageLabel = "Operations Review"; break;
        case "STORE_PREPARATION": stageLabel = "Store Preparation"; break;
        case "DISPATCH": stageLabel = "Dispatch & Delivery"; break;
        case "DELIVERY": stageLabel = "Out for Delivery"; break;
        case "CLOSED": stageLabel = "Completed & Closed"; break;
        default: stageLabel = stage; break;
      }
    }
  }

  let actionLabel = "";
  if (input.action) {
    const act = input.action;
    if (isAr) {
      switch (act) {
        case "APPROVE_FINANCE":
        case "FINANCE_APPROVE": actionLabel = "اعتماد المراجعة المالية"; break;
        case "FINANCE_RETURN": actionLabel = "إعادة إلى مندوب المبيعات"; break;
        case "FINANCE_REJECT": actionLabel = "رفض الطلب (المالية)"; break;
        case "OPERATIONS_APPROVE": actionLabel = "اعتماد الطلب وتحويله إلى المخزن"; break;
        case "OPERATIONS_RETURN_TO_FINANCE": actionLabel = "إعادة إلى المالية"; break;
        case "OPERATIONS_RETURN_TO_REP": actionLabel = "إعادة إلى مندوب المبيعات"; break;
        case "OPERATIONS_REJECT": actionLabel = "رفض الطلب (العمليات)"; break;
        case "STORE_START_PREPARE": actionLabel = "بدء تجهيز الطلب بالمخزن"; break;
        case "STORE_MARK_READY": actionLabel = "تحديد جاهز للتسليم والشحن"; break;
        case "STORE_REJECT": actionLabel = "رفض الطلب من المخزن"; break;
        case "DELIVERY_ASSIGN": actionLabel = "تعيين مسؤول التوصيل"; break;
        case "DELIVERY_START": actionLabel = "بدء جولة التوصيل"; break;
        case "DELIVERY_COMPLETE": actionLabel = "تأكيد التسليم والإغلاق"; break;
        case "DELIVERY_PARTIAL": actionLabel = "تأكيد التسليم الجزئي"; break;
        case "DELIVERY_REFUSE": actionLabel = "تسجيل رفض العميل"; break;
        case "DELIVERY_FAIL": actionLabel = "تسجيل فشل التوصيل"; break;
        case "DELIVERY_RETURN": actionLabel = "تسجيل إرجاع الطلب للمخزن"; break;
        case "DELIVERY_POSTPONE": actionLabel = "تأجيل موعد التوصيل"; break;
        case "RESUBMIT_REVISED": actionLabel = "إعادة تقديم الطلب بعد التعديل"; break;
        case "CANCEL": actionLabel = "إلغاء الطلب"; break;
        default: actionLabel = act.replace(/_/g, " "); break;
      }
    } else {
      switch (act) {
        case "APPROVE_FINANCE":
        case "FINANCE_APPROVE": actionLabel = "Approve Financial Review"; break;
        case "FINANCE_RETURN": actionLabel = "Return Order to Sales Rep"; break;
        case "FINANCE_REJECT": actionLabel = "Reject Order (Finance)"; break;
        case "OPERATIONS_APPROVE": actionLabel = "Approve & Release to Store"; break;
        case "OPERATIONS_RETURN_TO_FINANCE": actionLabel = "Return to Finance"; break;
        case "OPERATIONS_RETURN_TO_REP": actionLabel = "Return to Sales Representative"; break;
        case "OPERATIONS_REJECT": actionLabel = "Reject Order (Operations)"; break;
        case "STORE_START_PREPARE": actionLabel = "Begin Store Preparation"; break;
        case "STORE_MARK_READY": actionLabel = "Mark Ready for Dispatch"; break;
        case "STORE_REJECT": actionLabel = "Store Rejection"; break;
        case "DELIVERY_ASSIGN": actionLabel = "Assign Delivery Officer"; break;
        case "DELIVERY_START": actionLabel = "Dispatch Out for Delivery"; break;
        case "DELIVERY_COMPLETE": actionLabel = "Confirm Delivered & Closed"; break;
        case "DELIVERY_PARTIAL": actionLabel = "Confirm Partial Delivery"; break;
        case "DELIVERY_REFUSE": actionLabel = "Record Customer Refusal"; break;
        case "DELIVERY_FAIL": actionLabel = "Record Delivery Failure"; break;
        case "DELIVERY_RETURN": actionLabel = "Record Order Returned"; break;
        case "DELIVERY_POSTPONE": actionLabel = "Postpone Delivery Date"; break;
        case "RESUBMIT_REVISED": actionLabel = "Resubmit Revised Order"; break;
        case "CANCEL": actionLabel = "Cancel Order"; break;
        default: actionLabel = act.replace(/_/g, " "); break;
      }
    }
  }

  const shortDescription = isAr
    ? `الحالة: ${statusLabel || "غير محددة"}${stageLabel ? ` | المرحلة: ${stageLabel}` : ""}`
    : `Status: ${statusLabel || "N/A"}${stageLabel ? ` | Stage: ${stageLabel}` : ""}`;

  return {
    statusLabel,
    stageLabel,
    actionLabel,
    shortDescription
  };
}

export function getLocalizedWorkflowStage(stage?: string, lang: "en" | "ar" = "en"): string {
  if (!stage) return "";
  return getOrderWorkflowPresentation({ stage, lang }).stageLabel;
}

export function getLocalizedWorkflowStatus(status?: string, lang: "en" | "ar" = "en"): string {
  if (!status) return "";
  return getOrderWorkflowPresentation({ status, lang }).statusLabel;
}

export function getLocalizedWorkflowAction(action?: string, lang: "en" | "ar" = "en"): string {
  if (!action) return "";
  return getOrderWorkflowPresentation({ action, lang }).actionLabel;
}

export function getLocalizedCapability(capability?: string, lang: "en" | "ar" = "en"): string {
  if (!capability) return "";
  const isAr = lang === "ar";
  switch (capability) {
    case "CAN_VALIDATE_ORDER": return isAr ? "التحقق من الطلب" : "Validate Order";
    case "CAN_APPROVE_FINANCIALLY": return isAr ? "الاعتماد المالي" : "Financial Approval";
    case "CAN_REVIEW_STORE_ORDER": return isAr ? "مراجعة المستودع" : "Store Review";
    case "CAN_ASSIGN_DELIVERY": return isAr ? "تعيين التوصيل" : "Assign Delivery";
    case "CAN_COMPLETE_DELIVERY": return isAr ? "تأكيد التسليم" : "Complete Delivery";
    default: return capability.replace(/_/g, " ");
  }
}

export function getLocalizedRole(role?: string, lang: "en" | "ar" = "en"): string {
  if (!role) return "";
  const isAr = lang === "ar";
  switch (role) {
    case "Sales Representative":
    case "Medical Representative":
    case "SALES_REP": return isAr ? "مندوب المبيعات" : "Sales Representative";
    case "Sales Supervisor":
    case "SUPERVISOR": return isAr ? "مشرف المبيعات" : "Sales Supervisor";
    case "Finance Officer":
    case "FINANCE": return isAr ? "مسؤول المالي" : "Finance Officer";
    case "Order Operations Officer":
    case "OPERATIONS": return isAr ? "مسؤول عمليات الطلبات" : "Order Operations Officer";
    case "Warehouse / Store Manager":
    case "WAREHOUSE": return isAr ? "مدير المستودع" : "Warehouse / Store Manager";
    case "Delivery Officer":
    case "DELIVERY": return isAr ? "مسؤول التوصيل" : "Delivery Officer";
    case "System Administrator":
    case "ADMIN": return isAr ? "مدير النظام" : "System Administrator";
    default: return role;
  }
}
