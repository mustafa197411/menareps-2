import type { Permissions, SampleCapability, SampleRequestStatus, User } from "../types";
import { hasSampleCapability } from "./sampleAuthorization";

export type SampleManagementTab = "overview" | "catalog" | "inventory" | "requests" | "approvals" | "allocations" | "distribution";

export const SAMPLE_SIDEBAR_CHILDREN = [
  { id: "sample-management", label: { en: "Sample Management", ar: "إدارة العينات" } },
  { id: "samples-reports", label: { en: "Sample Reports", ar: "تقارير استهلاك العينات" } }
] as const;

export interface SampleManagementTabDefinition {
  id: SampleManagementTab;
  label: { en: string; ar: string };
  anyOf: readonly SampleCapability[];
}

export const SAMPLE_MANAGEMENT_TABS: readonly SampleManagementTabDefinition[] = [
  { id: "overview", label: { en: "Overview", ar: "نظرة عامة" }, anyOf: ["VIEW_SAMPLE_MANAGEMENT"] },
  { id: "catalog", label: { en: "Sample Catalog", ar: "كتالوج العينات" }, anyOf: ["VIEW_SAMPLE_MANAGEMENT"] },
  { id: "inventory", label: { en: "Inventory", ar: "المخزون" }, anyOf: ["VIEW_SAMPLE_INVENTORY"] },
  { id: "requests", label: { en: "Requests", ar: "الطلبات" }, anyOf: ["VIEW_OWN_SAMPLE_REQUESTS", "VIEW_TEAM_SAMPLE_REQUESTS"] },
  { id: "approvals", label: { en: "Approvals", ar: "الموافقات" }, anyOf: ["APPROVE_SAMPLE_REQUEST", "REJECT_SAMPLE_REQUEST"] },
  { id: "allocations", label: { en: "Allocations", ar: "التخصيصات" }, anyOf: ["VIEW_OWN_SAMPLE_BALANCE", "VIEW_TEAM_SAMPLE_BALANCE", "ALLOCATE_SAMPLE_STOCK"] },
  { id: "distribution", label: { en: "Physician Distribution", ar: "توزيع عينات الأطباء" }, anyOf: ["DISTRIBUTE_SAMPLE", "VIEW_PHYSICIAN_SAMPLE_HISTORY"] }
];

const LEGACY_SAMPLE_ROUTES: Readonly<Record<string, SampleManagementTab>> = {
  "samples-allocation": "allocations",
  "samples-approvals": "approvals",
  "samples-physician": "distribution",
  "samples-requests": "requests",
  "samples-inventory": "inventory"
};

export function isSampleManagementRoute(viewId: string): boolean {
  return viewId === "sample-management" || viewId.startsWith("sample-management?") || viewId === "samples-management" || viewId.startsWith("samples-management?") || viewId in LEGACY_SAMPLE_ROUTES;
}

export function resolveSampleManagementTab(viewId: string): SampleManagementTab {
  const queryTab = viewId.match(/^samples?-management\?tab=([a-z-]+)$/)?.[1];
  if (queryTab && SAMPLE_MANAGEMENT_TABS.some(tab => tab.id === queryTab)) return queryTab as SampleManagementTab;
  return LEGACY_SAMPLE_ROUTES[viewId] ?? "overview";
}

export function getSampleManagementRoute(tab: SampleManagementTab = "overview"): string {
  return tab === "overview" ? "sample-management" : `sample-management?tab=${tab}`;
}

export function getVisibleSampleManagementTabs(user: Pick<User, "role">, permissions?: Permissions): SampleManagementTabDefinition[] {
  return SAMPLE_MANAGEMENT_TABS.filter(tab => tab.anyOf.some(capability => hasSampleCapability(user, capability, permissions)));
}

export function getAuthorizedInitialSampleTab(user: Pick<User, "role">, requested: SampleManagementTab, permissions?: Permissions): SampleManagementTab {
  const visible = getVisibleSampleManagementTabs(user, permissions);
  return visible.some(tab => tab.id === requested) ? requested : (visible[0]?.id ?? "overview");
}

const STATUS_LABELS: Record<SampleRequestStatus, { en: string; ar: string }> = {
  PENDING_APPROVAL: { en: "Pending Approval", ar: "بانتظار الموافقة" },
  APPROVED: { en: "Approved — Awaiting Allocation", ar: "موافق عليه — بانتظار التخصيص" },
  AWAITING_ALLOCATION: { en: "Approved — Awaiting Allocation", ar: "موافق عليه — بانتظار التخصيص" },
  PARTIALLY_ALLOCATED: { en: "Partially Allocated", ar: "مخصص جزئياً" },
  ALLOCATED: { en: "Allocated — Stock Available", ar: "تم التخصيص — المخزون متاح" },
  REJECTED: { en: "Rejected", ar: "مرفوض" },
  CANCELLED: { en: "Cancelled", ar: "ملغى" }
};

export function getSampleRequestStatusLabel(status: SampleRequestStatus, lang: "en" | "ar"): string {
  return STATUS_LABELS[status][lang];
}

export function normalizeSampleRequestStatus(status: string): SampleRequestStatus {
  const normalized = status.trim().toUpperCase().replace(/[ -]+/g, "_");
  if (normalized === "PENDING") return "PENDING_APPROVAL";
  if (normalized === "APPROVED") return "AWAITING_ALLOCATION";
  if (normalized === "SHIPPED") return "PARTIALLY_ALLOCATED";
  if (normalized === "DELIVERED") return "ALLOCATED";
  if (normalized in STATUS_LABELS) return normalized as SampleRequestStatus;
  return "PENDING_APPROVAL";
}
