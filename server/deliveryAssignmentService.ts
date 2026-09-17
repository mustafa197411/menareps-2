import { randomUUID } from "node:crypto";
import { Role, normalizeRole, type User } from "../src/types";
import { applyOrderTransition, normalizeOrderStatus } from "../src/features/orders/orderWorkflowEngine";
import { getReadiness } from "../src/lib/userPolicyEngine";
import {
  createFirestoreDeliveryAssignmentRepository,
  type DeliveryAssignmentRepository,
  type DeliveryAssignmentUserRecord,
} from "./deliveryAssignmentRepository";

export interface DeliveryOfficerSelectorDto {
  uid: string;
  name: string;
  email: string;
  role: "Delivery Officer";
  managerId: string;
  country: string;
  readiness: "COMPLETE";
}

export interface DeliveryOfficerDirectoryResult {
  authorized: boolean;
  code?: string;
  officers: DeliveryOfficerSelectorDto[];
}

export interface DeliveryAssignRequest {
  orderId: string;
  deliveryOfficerUid: string;
  plannedDeliveryDate: string;
  plannedDeliveryWindow?: string;
  comments?: string;
}

export interface DeliveryAssignResult {
  success: boolean;
  code?: string;
  orderId?: string;
  previousStatus?: string;
  currentStatus?: string;
  stage?: string;
  deliveryOfficerUid?: string;
}

interface DeliveryAssignmentDependencies {
  repository: DeliveryAssignmentRepository;
  now(): string;
  auditId(): string;
}

const AUTHORIZED_ASSIGNMENT_ROLES = new Set<Role>([
  Role.STORE_MANAGER,
  Role.WAREHOUSE_MANAGER,
  Role.INVENTORY_OFFICER,
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function operationalStatus(value: unknown): boolean {
  const normalized = text(value).toUpperCase();
  return !normalized || normalized === "ACTIVE" || normalized === "OPERATIONAL";
}

function normalizedValues(values: unknown[]): Set<string> {
  return new Set(values.map((value) => text(value).toLocaleLowerCase()).filter(Boolean));
}

function normalizedCompanies(user: DeliveryAssignmentUserRecord): Set<string> {
  return normalizedValues([
    user.companyId,
    ...(Array.isArray(user.companyIds) ? user.companyIds : []),
    ...(Array.isArray(user.assignedCompanies) ? user.assignedCompanies : []),
  ]);
}

function normalizedGeographyPaths(user: DeliveryAssignmentUserRecord): Set<string> {
  const explicitPaths = [
    ...(Array.isArray(user.geographyPaths) ? user.geographyPaths : []),
    ...(Array.isArray(user.authorizedGeographyPaths) ? user.authorizedGeographyPaths : []),
  ].map((value) => typeof value === "string"
    ? value
    : [value?.countryId, value?.districtId, value?.cityId, value?.areaId || value?.territoryId].map(text).join("/"));
  const canonicalPath = [user.countryId || user.country, user.districtId, user.cityId, user.areaId || user.territoryId]
    .map(text)
    .join("/");
  return normalizedValues([...explicitPaths, canonicalPath]);
}

function compatibleScope(actor: DeliveryAssignmentUserRecord, officer: DeliveryAssignmentUserRecord): boolean {
  const actorCompanies = normalizedCompanies(actor);
  const officerCompanies = normalizedCompanies(officer);
  const actorGeographies = normalizedGeographyPaths(actor);
  const officerGeographies = normalizedGeographyPaths(officer);
  if (actorCompanies.size === 0 || officerCompanies.size === 0 || actorGeographies.size === 0 || officerGeographies.size === 0) return false;
  return Array.from(actorCompanies).some((company) => officerCompanies.has(company))
    && Array.from(actorGeographies).some((path) => officerGeographies.has(path));
}

function actorAuthorized(actor: DeliveryAssignmentUserRecord | null): actor is DeliveryAssignmentUserRecord {
  if (!actor) return false;
  const role = normalizeRole(actor.role);
  return AUTHORIZED_ASSIGNMENT_ROLES.has(role as Role)
    && actor.active !== false
    && actor.loginAllowed === true
    && actor.isDeleted !== true
    && operationalStatus(actor.status)
    && operationalStatus(actor.employmentStatus)
    && operationalStatus(actor.accountStatus);
}

export function evaluateDeliveryOfficerEligibility(
  actor: DeliveryAssignmentUserRecord,
  officer: DeliveryAssignmentUserRecord,
  readinessUsers: DeliveryAssignmentUserRecord[],
  authIdentityEnabled: boolean,
): { eligible: boolean; code?: string; dto?: DeliveryOfficerSelectorDto } {
  const uid = text(officer.id);
  if (!uid || text(officer.uid) && text(officer.uid) !== uid) return { eligible: false, code: "NON_CANONICAL_UID" };
  if (normalizeRole(officer.role) !== Role.DELIVERY_OFFICER) return { eligible: false, code: "OFFICER_ROLE_INVALID" };
  if (officer.active === false || !operationalStatus(officer.status) || !operationalStatus(officer.employmentStatus) || !operationalStatus(officer.accountStatus)) {
    return { eligible: false, code: "OFFICER_INACTIVE" };
  }
  if (officer.loginAllowed !== true || !authIdentityEnabled) return { eligible: false, code: "OFFICER_LOGIN_DISABLED" };
  if (officer.isDeleted === true) return { eligible: false, code: "OFFICER_DELETED" };
  if (text(officer.managerId) !== text(actor.id)) return { eligible: false, code: "OFFICER_MANAGER_MISMATCH" };
  if (!compatibleScope(actor, officer)) return { eligible: false, code: "OFFICER_SCOPE_MISMATCH" };
  const readiness = getReadiness(officer as unknown as Partial<User>, readinessUsers as unknown as User[]);
  if (readiness.status !== "Operational" || !readiness.reasons.includes("COMPLETE")) {
    return { eligible: false, code: "OFFICER_NOT_OPERATIONAL" };
  }
  return {
    eligible: true,
    dto: {
      uid,
      name: text(officer.name) || text(officer.fullName) || text(officer.email),
      email: text(officer.email),
      role: "Delivery Officer",
      managerId: text(officer.managerId),
      country: text(officer.country) || text(officer.countryId),
      readiness: "COMPLETE",
    },
  };
}

function dependencies(overrides?: Partial<DeliveryAssignmentDependencies>): DeliveryAssignmentDependencies {
  return {
    repository: overrides?.repository || createFirestoreDeliveryAssignmentRepository(),
    now: overrides?.now || (() => new Date().toISOString()),
    auditId: overrides?.auditId || (() => `AUD-${randomUUID()}`),
  };
}

async function readinessUsersFor(
  repository: DeliveryAssignmentRepository,
  actor: DeliveryAssignmentUserRecord,
  candidates: DeliveryAssignmentUserRecord[],
): Promise<DeliveryAssignmentUserRecord[]> {
  const managerIds = candidates.map((candidate) => text(candidate.managerId)).filter(Boolean);
  const managers = await repository.getUsersByIds(managerIds);
  return [actor, ...candidates, ...managers].filter((item, index, values) => values.findIndex((other) => other.id === item.id) === index);
}

export async function resolveEligibleDeliveryOfficers(
  authenticatedActorUid: string,
  overrides?: Partial<DeliveryAssignmentDependencies>,
): Promise<DeliveryOfficerDirectoryResult> {
  const deps = dependencies(overrides);
  const actor = await deps.repository.getActor(text(authenticatedActorUid));
  if (!actorAuthorized(actor)) return { authorized: false, code: actor ? "ACTOR_NOT_AUTHORIZED" : "ACTOR_NOT_FOUND", officers: [] };
  const candidates = await deps.repository.listDeliveryOfficerCandidates();
  const readinessUsers = await readinessUsersFor(deps.repository, actor, candidates);
  const officers: DeliveryOfficerSelectorDto[] = [];
  for (const candidate of candidates) {
    const authEnabled = await deps.repository.isAuthIdentityEnabled(candidate.id);
    const result = evaluateDeliveryOfficerEligibility(actor, candidate, readinessUsers, authEnabled);
    if (result.eligible && result.dto) officers.push(result.dto);
  }
  officers.sort((left, right) => left.name.localeCompare(right.name) || left.uid.localeCompare(right.uid));
  return { authorized: true, officers };
}

export function parseDeliveryAssignRequest(input: unknown): DeliveryAssignRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const allowed = new Set(["orderId", "deliveryOfficerUid", "plannedDeliveryDate", "plannedDeliveryWindow", "comments"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  const orderId = text(body.orderId);
  const deliveryOfficerUid = text(body.deliveryOfficerUid);
  const plannedDeliveryDate = text(body.plannedDeliveryDate);
  const plannedDeliveryWindow = text(body.plannedDeliveryWindow);
  const comments = text(body.comments);
  if (!orderId || !deliveryOfficerUid || !/^\d{4}-\d{2}-\d{2}$/.test(plannedDeliveryDate)) return null;
  if ([orderId, deliveryOfficerUid, plannedDeliveryWindow, comments].some((value) => value.length > 512)) return null;
  return { orderId, deliveryOfficerUid, plannedDeliveryDate, ...(plannedDeliveryWindow ? { plannedDeliveryWindow } : {}), ...(comments ? { comments } : {}) };
}

function assignmentPatch(updated: Record<string, any>): Record<string, any> {
  const keys = [
    "status", "stage", "updatedAt", "history", "deliveryOfficerUid", "deliveryOfficerId",
    "deliveryOfficerName", "deliveryOfficerEmail", "deliveryAssignedByUid", "deliveryAssignedByName",
    "deliveryAssignedAt", "deliveryAssignmentStatus", "plannedDeliveryDate", "plannedDeliveryWindow",
  ];
  const patch: Record<string, any> = {};
  for (const key of keys) if (updated[key] !== undefined) patch[key] = updated[key];
  patch.lastWorkflowAction = "DELIVERY_ASSIGN";
  return patch;
}

export async function executeDeliveryAssign(
  authenticatedActorUid: string,
  request: DeliveryAssignRequest,
  overrides?: Partial<DeliveryAssignmentDependencies>,
): Promise<DeliveryAssignResult> {
  const deps = dependencies(overrides);
  const authEnabled = await deps.repository.isAuthIdentityEnabled(request.deliveryOfficerUid);
  return deps.repository.runAssignmentTransaction(authenticatedActorUid, request.orderId, request.deliveryOfficerUid, async (context) => {
    if (!actorAuthorized(context.actor)) return { success: false, code: context.actor ? "ACTOR_NOT_AUTHORIZED" : "ACTOR_NOT_FOUND" };
    if (!context.order) return { success: false, code: "ORDER_NOT_FOUND" };
    if (!context.officer) return { success: false, code: "OFFICER_NOT_FOUND" };
    const readinessUsers = [context.actor, context.officer];
    const eligibility = evaluateDeliveryOfficerEligibility(context.actor, context.officer, readinessUsers, authEnabled);
    if (!eligibility.eligible || !eligibility.dto) return { success: false, code: eligibility.code || "OFFICER_NOT_ELIGIBLE" };
    const currentStatus = normalizeOrderStatus(context.order.data.status);
    const transition = applyOrderTransition({
      order: context.order.data,
      action: "DELIVERY_ASSIGN",
      actor: { uid: context.actor.id, role: normalizeRole(context.actor.role), name: text(context.actor.name) || text(context.actor.email) || "Store Manager" },
      comments: request.comments,
      source: "BACKEND",
      deliveryAssignment: {
        deliveryOfficerUid: eligibility.dto.uid,
        deliveryOfficerName: eligibility.dto.name,
        deliveryOfficerEmail: eligibility.dto.email,
        deliveryAssignmentStatus: "ASSIGNED",
        plannedDeliveryDate: request.plannedDeliveryDate,
        plannedDeliveryWindow: request.plannedDeliveryWindow || "Standard",
      },
    });
    if (!transition.success || !transition.historyEntry) return { success: false, code: transition.reasonCode || "TRANSITION_DENIED" };
    const now = deps.now();
    transition.updatedOrder.updatedAt = now;
    transition.updatedOrder.deliveryAssignedAt = now;
    transition.updatedOrder.deliveryAssignedByUid = context.actor.id;
    transition.updatedOrder.deliveryAssignedByName = text(context.actor.name) || text(context.actor.email) || "Store Manager";
    transition.updatedOrder.deliveryOfficerId = eligibility.dto.uid;
    transition.historyEntry.createdAt = now;
    transition.updatedOrder.history = [...(Array.isArray(context.order.data.history) ? context.order.data.history : []), transition.historyEntry];
    const audit = {
      id: deps.auditId(), actorUid: context.actor.id, actorRole: normalizeRole(context.actor.role),
      action: "DELIVERY_ASSIGN", entityType: "Order", entityId: context.order.id,
      previousStatus: currentStatus, currentStatus: transition.updatedOrder.status,
      deliveryOfficerUid: eligibility.dto.uid, createdAt: now,
    };
    context.write(assignmentPatch(transition.updatedOrder), audit);
    return {
      success: true, orderId: context.order.id, previousStatus: currentStatus,
      currentStatus: transition.updatedOrder.status, stage: transition.updatedOrder.stage,
      deliveryOfficerUid: eligibility.dto.uid,
    };
  });
}
