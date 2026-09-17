import { CRM_MODULE_PERMISSIONS } from "./userPolicyEngine";
import type { User } from "../types";
import { isCanonicalPermissionApplicable, permitsApplicableCapability } from "./canonicalPermissionApplicability";

export const VISIT_MARKETING_REQUEST_RESOURCE = "VISIT_MARKETING_REQUEST" as const;
export const VISIT_MARKETING_REQUEST_SCHEMA_VERSION = 1;

export type VisitMarketingRequestStatus =
  | "PENDING_SUPERVISOR"
  | "PENDING_FINAL_APPROVAL"
  | "APPROVED"
  | "EXECUTED"
  | "REJECTED"
  | "CANCELLED";

export type VisitMarketingRequestAction =
  | "CREATE"
  | "SUPERVISOR_APPROVE"
  | "SUPERVISOR_REJECT"
  | "FINAL_APPROVE"
  | "FINAL_REJECT"
  | "EXECUTE"
  | "CANCEL";

export interface VisitMarketingRequestDraft {
  requestType: "Sponsorship" | "Round Table" | "Stand Alone" | "Symposium" | "Flyers" | "Other";
  urgency: "High" | "Medium" | "Low";
  plannedDate?: string;
  estimatedBudget?: number;
  description: string;
}

export interface CanonicalVisitMarketingRequest extends VisitMarketingRequestDraft {
  id: string;
  resourceType: typeof VISIT_MARKETING_REQUEST_RESOURCE;
  creatorUid: string;
  representativeUid: string;
  supervisorUid: string;
  visitId: string;
  physicianId: string;
  areaId: string;
  countryId: string;
  marketId: string;
  productIds?: string[];
  promotionGroupIds?: string[];
  status: VisitMarketingRequestStatus;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  supervisorReviewedByUid?: string;
  supervisorReviewedAt?: string;
  finalReviewedByUid?: string;
  finalReviewedAt?: string;
  rejectedByUid?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  cancelledByUid?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  executedByUid?: string;
  executedAt?: string;
  executionNote?: string;
  authorizedActions?: VisitMarketingRequestAction[];
}

export interface VisitMarketingRequestAuditEvent {
  id: string;
  requestId: string;
  resourceType: typeof VISIT_MARKETING_REQUEST_RESOURCE;
  actorUid: string;
  action: "CREATED" | "SUPERVISOR_APPROVED" | "SUPERVISOR_REJECTED" | "FINAL_APPROVED" | "FINAL_REJECTED" | "CANCELLED" | "EXECUTED";
  fromStatus: VisitMarketingRequestStatus | null;
  toStatus: VisitMarketingRequestStatus;
  occurredAt: string;
  reason?: string;
  comment?: string;
}

export interface MarketingRequestPermissionRecord {
  active?: boolean;
  approve?: boolean;
  reject?: boolean;
  marketingRequestCapabilities?: {
    supervisorApprove?: boolean;
    supervisorReject?: boolean;
    finalApprove?: boolean;
    finalReject?: boolean;
    execute?: boolean;
  };
  modules?: Record<string, { approve?: boolean; reject?: boolean; execute?: boolean }>;
  execute?: boolean;
}

const REQUEST_TYPES = new Set(["Sponsorship", "Round Table", "Stand Alone", "Symposium", "Flyers", "Other"]);
const URGENCIES = new Set(["High", "Medium", "Low"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function parseVisitMarketingRequestDraft(value: unknown): VisitMarketingRequestDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const requestType = text(input.requestType);
  const urgency = text(input.urgency);
  const description = text(input.description);
  const plannedDate = text(input.plannedDate);
  const estimatedBudget = input.estimatedBudget === undefined || input.estimatedBudget === null || input.estimatedBudget === ""
    ? undefined : Number(input.estimatedBudget);
  if (!REQUEST_TYPES.has(requestType) || !URGENCIES.has(urgency) || !description) return null;
  if (plannedDate && !ISO_DATE.test(plannedDate)) return null;
  if (estimatedBudget !== undefined && (!Number.isFinite(estimatedBudget) || estimatedBudget < 0)) return null;
  return {
    requestType: requestType as VisitMarketingRequestDraft["requestType"],
    urgency: urgency as VisitMarketingRequestDraft["urgency"],
    ...(plannedDate ? { plannedDate } : {}),
    ...(estimatedBudget !== undefined ? { estimatedBudget } : {}),
    description,
  };
}

export function isCanonicalUserActive(user: Partial<User> & Record<string, unknown>): boolean {
  return user.active !== false && user.loginAllowed !== false && user.isDeleted !== true
    && !["Inactive", "Archived", "Suspended"].includes(text(user.status))
    && !["Inactive", "Archived", "Suspended"].includes(text(user.employmentStatus))
    && text(user.accountStatus) !== "INACTIVE";
}

function moduleDefault(role: string, action: "approve" | "reject" | "execute"): boolean {
  const roleRules = CRM_MODULE_PERMISSIONS[role as keyof typeof CRM_MODULE_PERMISSIONS];
  return roleRules?.["Marketing Activities"]?.[action] === true;
}

export function hasVisitMarketingRequestPermission(
  role: string,
  action: "supervisorApprove" | "supervisorReject" | "finalApprove" | "finalReject" | "execute",
  dynamic?: MarketingRequestPermissionRecord | null,
): boolean {
  if (dynamic?.active === false) return false;
  const domain = action.startsWith("supervisor")
    ? "MARKETING_REQUEST_SUPERVISOR"
    : action === "execute" ? "MARKETING_REQUEST_EXECUTE" : "MARKETING_REQUEST_FINAL";
  if (!isCanonicalPermissionApplicable(role, domain)) return false;
  const explicit = dynamic?.marketingRequestCapabilities?.[action];
  if (typeof explicit === "boolean") return permitsApplicableCapability(true, explicit, false);
  const permissionAction = action === "execute" ? "execute" : action.endsWith("Approve") ? "approve" : "reject";
  const moduleOverride = dynamic?.modules?.["Marketing Activities"]?.[permissionAction];
  if (typeof moduleOverride === "boolean") return moduleOverride === true;
  // Generic approve/reject is not a lifecycle authority source.
  return moduleDefault(role, permissionAction);
}

export function nextVisitMarketingRequestStatus(
  status: VisitMarketingRequestStatus,
  action: VisitMarketingRequestAction,
): VisitMarketingRequestStatus | null {
  if (status === "PENDING_SUPERVISOR") {
    if (action === "SUPERVISOR_APPROVE") return "PENDING_FINAL_APPROVAL";
    if (action === "SUPERVISOR_REJECT") return "REJECTED";
    if (action === "CANCEL") return "CANCELLED";
  }
  if (status === "PENDING_FINAL_APPROVAL") {
    if (action === "FINAL_APPROVE") return "APPROVED";
    if (action === "FINAL_REJECT") return "REJECTED";
    if (action === "CANCEL") return "CANCELLED";
  }
  if (status === "APPROVED" && action === "EXECUTE") return "EXECUTED";
  return null;
}

export function isApplicableVisitMarketingSupervisor(input: {
  representativeUid: string;
  representativeManagerId?: string;
  supervisorUid: string;
  supervisor: Partial<User> & Record<string, unknown>;
  permissions?: MarketingRequestPermissionRecord | null;
}): boolean {
  return Boolean(input.representativeUid)
    && input.representativeManagerId === input.supervisorUid
    && isCanonicalUserActive(input.supervisor)
    && hasVisitMarketingRequestPermission(String(input.supervisor.role || ""), "supervisorApprove", input.permissions)
    && hasVisitMarketingRequestPermission(String(input.supervisor.role || ""), "supervisorReject", input.permissions);
}

export function isEligibleVisitMarketingFinalApprover(input: {
  actorUid: string;
  creatorUid: string;
  actor: Partial<User> & Record<string, unknown>;
  activeAncestorUids: string[];
  requestAreaId: string;
  actorAreaIds: string[];
  action: "finalApprove" | "finalReject" | "execute";
  permissions?: MarketingRequestPermissionRecord | null;
}): boolean {
  return input.actorUid !== input.creatorUid
    && isCanonicalUserActive(input.actor)
    && input.activeAncestorUids.includes(input.actorUid)
    && input.actorAreaIds.includes(input.requestAreaId)
    && hasVisitMarketingRequestPermission(String(input.actor.role || ""), input.action, input.permissions);
}

export type MarketingActionDecisionCode = "AUTHORIZED" | "INVALID_APPROVAL_STATE" | "SELF_EXECUTION_DENIED" | "ACTOR_INACTIVE" | "EXECUTE_CAPABILITY_DENIED" | "EXECUTE_FUNCTIONAL_SCOPE_DENIED" | "FINAL_APPROVER_HIERARCHY_DENIED";

export function evaluateVisitMarketingExecute(input: {
  actorUid: string; actor: Partial<User> & Record<string, unknown>; request: CanonicalVisitMarketingRequest;
  actorAreaIds: string[]; permissions?: MarketingRequestPermissionRecord | null;
}): { allowed: boolean; code: MarketingActionDecisionCode } {
  if (input.request.status !== "APPROVED" || !input.request.supervisorReviewedByUid || !input.request.supervisorReviewedAt || !input.request.finalReviewedByUid || !input.request.finalReviewedAt) return { allowed: false, code: "INVALID_APPROVAL_STATE" };
  if (input.actorUid === input.request.creatorUid) return { allowed: false, code: "SELF_EXECUTION_DENIED" };
  if (!isCanonicalUserActive(input.actor)) return { allowed: false, code: "ACTOR_INACTIVE" };
  if (!hasVisitMarketingRequestPermission(String(input.actor.role || ""), "execute", input.permissions)) return { allowed: false, code: "EXECUTE_CAPABILITY_DENIED" };
  if (!input.actorAreaIds.includes(input.request.areaId)) return { allowed: false, code: "EXECUTE_FUNCTIONAL_SCOPE_DENIED" };
  return { allowed: true, code: "AUTHORIZED" };
}
