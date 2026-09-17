import { normalizeRole } from "../../types";
import { applyOrderTransition, canTransitionOrder, type OrderCapability, type OrderStage } from "./orderWorkflowEngine";

export interface WorkflowStageTemplate { stage: OrderStage; allowedRoles: string[]; capabilities: OrderCapability[]; active: boolean }
export interface OrderWorkflowTemplate { templateId: string; name: string; marketIds: string[]; active: boolean; stages: WorkflowStageTemplate[]; policy?: { creditCheckEnabled?: boolean; creditLimit?: number; autoApprovalThreshold?: number | string }; createdBy: string; createdAt: string; updatedBy: string; updatedAt: string }

export const ENTERPRISE_WORKFLOW_TEMPLATE: OrderWorkflowTemplate = {
  templateId: "ENTERPRISE_V1", name: "Enterprise separated workflow", marketIds: [], active: true,
  stages: [
    { stage: "SUBMISSION", allowedRoles: ["Sales Representative", "Medical Representative"], capabilities: ["ORDER_CREATE", "ORDER_SUBMIT"], active: true },
    { stage: "FINANCE_REVIEW", allowedRoles: ["Finance Officer", "Finance Manager"], capabilities: ["ORDER_FINANCE_REVIEW", "ORDER_FINANCE_APPROVE", "ORDER_FINANCE_REJECT", "ORDER_FINANCE_RETURN"], active: true },
    { stage: "OPERATIONS_REVIEW", allowedRoles: ["Order Operations Officer"], capabilities: ["ORDER_OPERATIONS_REVIEW", "ORDER_OPERATIONS_APPROVE", "ORDER_OPERATIONS_REJECT", "ORDER_OPERATIONS_RETURN"], active: true },
    { stage: "STORE_PREPARATION", allowedRoles: ["Store Manager", "Warehouse Manager"], capabilities: ["ORDER_STORE_PREPARE", "ORDER_STORE_READY", "ORDER_START_PREPARATION", "ORDER_MARK_PACKED"], active: true },
    { stage: "DISPATCH", allowedRoles: ["Store Manager", "Warehouse Manager", "Inventory Officer"], capabilities: ["ORDER_DELIVERY_ASSIGN"], active: true },
    { stage: "DELIVERY", allowedRoles: ["Delivery Officer"], capabilities: ["ORDER_DELIVERY_EXECUTE", "ORDER_DELIVERY_COMPLETE", "ORDER_DELIVERY_RETURN"], active: true },
  ], createdBy: "SYSTEM_DEFAULT", createdAt: "2026-01-01T00:00:00Z", updatedBy: "SYSTEM_DEFAULT", updatedAt: "2026-01-01T00:00:00Z",
};

export function isOrderWorkflowTemplate(value: unknown): value is OrderWorkflowTemplate {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<OrderWorkflowTemplate>;
  return typeof record.templateId === "string" && typeof record.name === "string" && typeof record.active === "boolean" && Array.isArray(record.marketIds) && Array.isArray(record.stages)
    && record.stages.every(stage => stage && typeof stage.stage === "string" && Array.isArray(stage.allowedRoles) && Array.isArray(stage.capabilities) && typeof stage.active === "boolean");
}

export function isRuntimeOrderWorkflowTemplate(value: unknown): value is OrderWorkflowTemplate {
  if (!isOrderWorkflowTemplate(value) || value.active !== true || value.templateId !== ENTERPRISE_WORKFLOW_TEMPLATE.templateId) return false;
  const submission = value.stages.find(stage => stage.active && stage.stage === "SUBMISSION");
  const finance = value.stages.find(stage => stage.active && stage.stage === "FINANCE_REVIEW");
  return Boolean(submission?.capabilities.includes("ORDER_CREATE") && submission.capabilities.includes("ORDER_SUBMIT") && finance);
}

const ACTION_STAGE: Record<string, OrderStage> = {
  SUBMIT: "SUBMISSION", APPROVE_FINANCE: "FINANCE_REVIEW", FINANCE_APPROVE: "FINANCE_REVIEW", FINANCE_REJECT: "FINANCE_REVIEW", FINANCE_RETURN: "FINANCE_REVIEW",
  OPERATIONS_APPROVE: "OPERATIONS_REVIEW", OPERATIONS_REJECT: "OPERATIONS_REVIEW", OPERATIONS_RETURN_TO_FINANCE: "OPERATIONS_REVIEW", OPERATIONS_RETURN_TO_REP: "OPERATIONS_REVIEW",
  STORE_START_PREPARE: "STORE_PREPARATION", STORE_MARK_READY: "STORE_PREPARATION", STORE_REJECT: "STORE_PREPARATION", STORE_RETURN_TO_OPS: "STORE_PREPARATION",
  DELIVERY_ASSIGN: "DISPATCH",
  DELIVERY_START: "DELIVERY", DELIVERY_COMPLETE: "DELIVERY", DELIVERY_PARTIAL: "DELIVERY", DELIVERY_REFUSE: "DELIVERY", DELIVERY_FAIL: "DELIVERY", DELIVERY_RETURN: "DELIVERY", DELIVERY_POSTPONE: "DELIVERY",
};

export function capabilitiesForWorkflowAction(template: OrderWorkflowTemplate, action: string, role: string): OrderCapability[] {
  if (!template.active) return [];
  const stage = ACTION_STAGE[action];
  if (!stage) return [];
  const rule = template.stages.find(item => item.active && item.stage === stage);
  if (!rule || !rule.allowedRoles.some(allowed => normalizeRole(allowed) === normalizeRole(role))) return [];
  return [...rule.capabilities];
}

export function canTransitionOrderWithTemplate(params: Parameters<typeof canTransitionOrder>[0] & { template: OrderWorkflowTemplate }) {
  return canTransitionOrder({ ...params, orderPermissions: capabilitiesForWorkflowAction(params.template, params.action, params.actor.role) });
}

export function applyOrderTransitionWithTemplate(params: Parameters<typeof applyOrderTransition>[0] & { template: OrderWorkflowTemplate }) {
  return applyOrderTransition({ ...params, orderPermissions: capabilitiesForWorkflowAction(params.template, params.action, params.actor.role) });
}
