import { normalizeOrderStatus, type OrderStatus } from "./orderWorkflowEngine";
import { classifyInventoryContract } from "./inventoryContractClassifier";

export interface DeliveryLifecycleOrder {
  status?: string | null;
  inventoryContractVersion?: number | string | null;
  deliveryOfficerUid?: string | null;
  deliveryAssignmentStatus?: string | null;
  reservationIds?: unknown;
  physicalDemand?: unknown;
  inventoryReservationId?: unknown;
}

export interface DeliveryLifecycleDecision {
  status: OrderStatus;
  version2: boolean;
  inventoryContractIntegrityError: boolean;
  canonicalAssignmentPresent: boolean;
  authenticatedOfficerMatches: boolean;
  assignmentRequired: boolean;
  startDeliveryAllowed: boolean;
  finalOutcomesAllowed: boolean;
  partialDeliveryAllowed: boolean;
  terminal: boolean;
  showDeliveryWorkstation: boolean;
}

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function isVersion2Order(order: DeliveryLifecycleOrder | null | undefined): boolean {
  return classifyInventoryContract(order).version2;
}

export function hasCanonicalDeliveryAssignment(order: DeliveryLifecycleOrder | null | undefined): boolean {
  const uid = text(order?.deliveryOfficerUid);
  const status = text(order?.deliveryAssignmentStatus).toUpperCase();
  return Boolean(uid) && status === "ASSIGNED";
}

export function authenticatedOfficerMatchesAssignment(
  order: DeliveryLifecycleOrder | null | undefined,
  authenticatedUid: string | null | undefined,
): boolean {
  return hasCanonicalDeliveryAssignment(order) && text(order?.deliveryOfficerUid) === text(authenticatedUid);
}

export function resolveDeliveryLifecycleDecision(
  order: DeliveryLifecycleOrder | null | undefined,
  authenticatedUid: string | null | undefined,
): DeliveryLifecycleDecision {
  const status = normalizeOrderStatus(order?.status);
  const inventoryContract = classifyInventoryContract(order);
  const version2 = inventoryContract.version2;
  const canonicalAssignmentPresent = hasCanonicalDeliveryAssignment(order);
  const authenticatedOfficerMatches = authenticatedOfficerMatchesAssignment(order, authenticatedUid);
  const preStart = status === "READY_FOR_DISPATCH" || status === "ASSIGNED_FOR_DELIVERY";
  const terminal = ["DELIVERED", "DELIVERY_FAILED", "CUSTOMER_REFUSED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "EXPIRED", "CLOSED"].includes(status);
  const legacyFinalSource = ["READY_FOR_DISPATCH", "ASSIGNED_FOR_DELIVERY", "OUT_FOR_DELIVERY"].includes(status);

  return {
    status,
    version2,
    inventoryContractIntegrityError: inventoryContract.kind === "INTEGRITY_ERROR",
    canonicalAssignmentPresent,
    authenticatedOfficerMatches,
    assignmentRequired: status === "READY_FOR_DISPATCH" && !canonicalAssignmentPresent,
    startDeliveryAllowed: inventoryContract.kind !== "INTEGRITY_ERROR" && version2 && preStart && authenticatedOfficerMatches,
    finalOutcomesAllowed: inventoryContract.kind === "INTEGRITY_ERROR" ? false : version2 ? status === "OUT_FOR_DELIVERY" && authenticatedOfficerMatches : legacyFinalSource,
    partialDeliveryAllowed: inventoryContract.kind === "LEGACY" && legacyFinalSource,
    terminal,
    showDeliveryWorkstation: preStart || status === "OUT_FOR_DELIVERY" || terminal,
  };
}

export function deliveryActionCandidatesForOrder(
  order: DeliveryLifecycleOrder | null | undefined,
  authenticatedUid: string | null | undefined,
): string[] {
  const decision = resolveDeliveryLifecycleDecision(order, authenticatedUid);
  if (decision.startDeliveryAllowed) return ["DELIVERY_START"];
  if (!decision.finalOutcomesAllowed) return [];
  return [
    "DELIVERY_COMPLETE",
    ...(decision.partialDeliveryAllowed ? ["DELIVERY_PARTIAL"] : []),
    "DELIVERY_REFUSE",
    "DELIVERY_FAIL",
    "DELIVERY_RETURN",
    "DELIVERY_POSTPONE",
  ];
}
