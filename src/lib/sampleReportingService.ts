import type { Physician, Product, SampleAllocation, SampleApproval, SampleBatch, SampleDistribution, SampleInventoryBalance, SampleInventoryMovement, SampleRequest, SampleSku, User } from "../types";

export const DEFAULT_NEAR_EXPIRY_DISPLAY_DAYS = 90;
export type RequestedVsActualCategory = "MATCHED" | "DIFFERENT_PHYSICIAN" | "NO_INTENDED_PHYSICIAN" | "NOT_YET_DISTRIBUTED";
export type SampleReportSection = "summary" | "inventory" | "requests" | "allocations" | "distribution" | "requested-actual" | "expiry" | "movements";

export interface SampleReportDataset {
  skus: SampleSku[];
  products: Product[];
  users: User[];
  physicians: Physician[];
  inventory: SampleInventoryBalance[];
  batches: SampleBatch[];
  requests: SampleRequest[];
  approvals: SampleApproval[];
  allocations: SampleAllocation[];
  distributions: SampleDistribution[];
  movements: SampleInventoryMovement[];
}

export interface SampleReportFilters {
  dateFrom?: string;
  dateTo?: string;
  sampleSkuId?: string;
  productId?: string;
  repId?: string;
  physicianId?: string;
  status?: string;
  batchId?: string;
  requestSource?: string;
  movementType?: string;
}

const byId = <T extends { id: string }>(items: readonly T[]) => new Map(items.map(item => [item.id, item]));
const inDateRange = (value: string | undefined, filters: SampleReportFilters) => (!filters.dateFrom || (value || "") >= filters.dateFrom) && (!filters.dateTo || (value || "") <= `${filters.dateTo}T23:59:59.999Z`);
const nameOf = <T extends { id: string; name?: string }>(map: Map<string, T>, id?: string, fallback?: string) => id ? map.get(id)?.name || fallback || id : "—";

export function scopeSampleReportData(data: SampleReportDataset, authorizedRepIds: readonly string[]): SampleReportDataset {
  const allowed = new Set(authorizedRepIds);
  const requests = data.requests.filter(item => allowed.has(item.repId));
  const requestIds = new Set(requests.map(item => item.id));
  return {
    ...data,
    requests,
    approvals: data.approvals.filter(item => (item.repId ? allowed.has(item.repId) : requestIds.has(item.requestId))),
    allocations: data.allocations.filter(item => allowed.has(item.repId)),
    distributions: data.distributions.filter(item => allowed.has(item.repId))
  };
}

export function buildSampleInventoryReport(data: SampleReportDataset, filters: SampleReportFilters = {}) {
  const skus = byId(data.skus), products = byId(data.products), movements = data.movements;
  return data.batches.filter(batch => (!filters.sampleSkuId || batch.sampleSkuId === filters.sampleSkuId) && (!filters.batchId || batch.id === filters.batchId || batch.batchNumber === filters.batchId) && (!filters.status || batch.status === filters.status) && inDateRange(batch.expiryDate, filters)).map(batch => {
    const sku = skus.get(batch.sampleSkuId), productId = sku?.productId || "";
    const balances = data.inventory.filter(item => item.sampleSkuId === batch.sampleSkuId && (!item.batchId || item.batchId === batch.id));
    const lastMovementDate = movements.filter(item => item.sampleSkuId === batch.sampleSkuId && (!item.batchId || item.batchId === batch.id)).map(item => item.createdAt).sort().at(-1);
    return { sampleSkuId: batch.sampleSkuId, sampleName: sku?.name || batch.sampleSkuId, productId, productName: nameOf(products, productId), batchId: batch.id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, receivedQuantity: batch.receivedQuantity, availableQuantity: batch.availableQuantity, allocatedQuantity: balances.reduce((sum, item) => sum + item.allocatedQuantity, 0), expiredOrBlockedQuantity: balances.reduce((sum, item) => sum + item.expiredOrBlockedQuantity, 0), status: batch.status, lastMovementDate: lastMovementDate || "—" };
  }).filter(row => !filters.productId || row.productId === filters.productId);
}

export function buildSampleRequestLifecycleReport(data: SampleReportDataset, filters: SampleReportFilters = {}) {
  const skus = byId(data.skus), products = byId(data.products), users = byId(data.users), physicians = byId(data.physicians);
  return data.requests.filter(request => (!filters.repId || request.repId === filters.repId) && (!filters.sampleSkuId || request.sampleSkuId === filters.sampleSkuId) && (!filters.productId || request.productId === filters.productId) && (!filters.status || request.status === filters.status) && (!filters.requestSource || request.source === filters.requestSource) && inDateRange(request.createdAt, filters)).map(request => {
    const approval = data.approvals.filter(item => item.requestId === request.id).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
    const allocatedQuantity = data.allocations.filter(item => item.requestId === request.id && item.status !== "CANCELLED").reduce((sum, item) => sum + item.quantityAllocated, 0);
    const approvedQuantity = approval?.approvedQuantity ?? request.approvedQuantity ?? 0;
    return { requestId: request.id, repId: request.repId, representative: nameOf(users, request.repId), sampleSkuId: request.sampleSkuId, sampleName: skus.get(request.sampleSkuId)?.name || request.sampleSkuId, productId: request.productId, productName: nameOf(products, request.productId), requestedQuantity: request.quantityRequested, approvedQuantity, allocatedQuantity, remainingApprovedQuantity: Math.max(0, approvedQuantity - allocatedQuantity), status: request.status, urgent: request.urgent ? "YES" : "NO", requestedForPhysicianId: request.requestedForPhysicianId || "", intendedPhysician: nameOf(physicians, request.requestedForPhysicianId), source: request.source, submittedAt: request.createdAt, approverId: approval?.approverId || "", approver: nameOf(users, approval?.approverId), decisionAt: approval?.decidedAt || "—", rejectionReason: approval?.rejectionReason || "" };
  });
}

export function buildSampleAllocationReport(data: SampleReportDataset, filters: SampleReportFilters = {}) {
  const skus = byId(data.skus), products = byId(data.products), users = byId(data.users), batches = byId(data.batches);
  return data.allocations.filter(item => (!filters.repId || item.repId === filters.repId) && (!filters.sampleSkuId || item.sampleSkuId === filters.sampleSkuId) && (!filters.productId || item.productId === filters.productId) && (!filters.status || item.status === filters.status) && (!filters.batchId || item.batchId === filters.batchId) && inDateRange(item.allocatedAt, filters)).map(item => ({ representative: nameOf(users, item.repId), repId: item.repId, sampleSkuId: item.sampleSkuId, sampleName: skus.get(item.sampleSkuId)?.name || item.sampleSkuId, productId: item.productId, productName: nameOf(products, item.productId), allocationId: item.id, allocationSource: item.requestId ? "REQUEST" : "DIRECT", requestId: item.requestId || "", approvalId: item.approvalId || "", batchId: item.batchId || "", batchNumber: item.batchId ? batches.get(item.batchId)?.batchNumber || item.batchId : "—", allocatedQuantity: item.quantityAllocated, distributedQuantity: item.quantityDistributed, remainingQuantity: item.quantityRemaining, allocatedAt: item.allocatedAt, allocatorId: item.allocatedBy, allocator: nameOf(users, item.allocatedBy), status: item.status, flags: [item.requestId ? "REQUEST_LINKED" : "DIRECT_ALLOCATION", !item.inventoryMovementId ? "MISSING_MOVEMENT_REFERENCE" : ""].filter(Boolean).join(", ") }));
}

export function buildRepresentativeBalanceReport(data: SampleReportDataset, filters: SampleReportFilters = {}) {
  const rows = buildSampleAllocationReport(data, filters), grouped = new Map<string, { repId: string; representative: string; sampleSkuId: string; sampleName: string; productId: string; totalAllocated: number; totalDistributed: number; currentRemaining: number }>();
  for (const row of rows.filter(item => item.status !== "CANCELLED")) { const key = `${row.repId}|${row.sampleSkuId}`, current = grouped.get(key) || { repId: row.repId, representative: row.representative, sampleSkuId: row.sampleSkuId, sampleName: row.sampleName, productId: row.productId, totalAllocated: 0, totalDistributed: 0, currentRemaining: 0 }; current.totalAllocated += row.allocatedQuantity; current.totalDistributed += row.distributedQuantity; current.currentRemaining += row.remainingQuantity; grouped.set(key, current); }
  return [...grouped.values()];
}

export function buildSampleDistributionReport(data: SampleReportDataset, filters: SampleReportFilters = {}) {
  const skus = byId(data.skus), products = byId(data.products), users = byId(data.users), physicians = byId(data.physicians), batches = byId(data.batches);
  return data.distributions.filter(item => (!filters.repId || item.repId === filters.repId) && (!filters.physicianId || item.physicianId === filters.physicianId) && (!filters.sampleSkuId || item.sampleSkuId === filters.sampleSkuId) && (!filters.productId || item.productId === filters.productId) && (!filters.batchId || item.batchId === filters.batchId) && inDateRange(item.distributedAt, filters)).map(item => { const physician = physicians.get(item.physicianId); return { distributionId: item.id, distributedAt: item.distributedAt, repId: item.repId, representative: nameOf(users, item.repId), physicianId: item.physicianId, physician: nameOf(physicians, item.physicianId), physicianCategory: physician?.classification || "—", physicianSpecialty: physician?.specialty || "—", sampleSkuId: item.sampleSkuId, sampleName: skus.get(item.sampleSkuId)?.name || item.sampleSkuId, productId: item.productId, productName: nameOf(products, item.productId), quantity: item.quantity, allocationId: item.allocationId, batchId: item.batchId || "", batchNumber: item.batchId ? batches.get(item.batchId)?.batchNumber || item.batchId : "—", requestId: item.requestId || "", visitId: item.visitId || "", notes: item.notes || "", flags: [!item.requestId ? "NO_REQUEST_LINEAGE" : "", !item.allocationId ? "MISSING_ALLOCATION_REFERENCE" : ""].filter(Boolean).join(", ") }; });
}

export function buildRequestedVsActualPhysicianReport(data: SampleReportDataset, filters: SampleReportFilters = {}) {
  const requests = buildSampleRequestLifecycleReport(data, filters), distributions = buildSampleDistributionReport(data, filters), physicians = byId(data.physicians);
  return requests.flatMap(request => { const actual = distributions.filter(item => item.requestId === request.requestId); if (!actual.length) return [{ requestId: request.requestId, repId: request.repId, representative: request.representative, sampleSkuId: request.sampleSkuId, sampleName: request.sampleName, requestedForPhysicianId: request.requestedForPhysicianId, requestedForPhysician: request.intendedPhysician, actualPhysicianId: "", actualPhysician: "—", requestedQuantity: request.requestedQuantity, approvedQuantity: request.approvedQuantity, allocatedQuantity: request.allocatedQuantity, distributedQuantity: 0, distributionDate: "—", resultCategory: "NOT_YET_DISTRIBUTED" as RequestedVsActualCategory, complianceViolation: false }]; return actual.map(item => ({ requestId: request.requestId, repId: request.repId, representative: request.representative, sampleSkuId: request.sampleSkuId, sampleName: request.sampleName, requestedForPhysicianId: request.requestedForPhysicianId, requestedForPhysician: request.intendedPhysician, actualPhysicianId: item.physicianId, actualPhysician: nameOf(physicians, item.physicianId), requestedQuantity: request.requestedQuantity, approvedQuantity: request.approvedQuantity, allocatedQuantity: request.allocatedQuantity, distributedQuantity: item.quantity, distributionDate: item.distributedAt, resultCategory: (!request.requestedForPhysicianId ? "NO_INTENDED_PHYSICIAN" : request.requestedForPhysicianId === item.physicianId ? "MATCHED" : "DIFFERENT_PHYSICIAN") as RequestedVsActualCategory, complianceViolation: false })); });
}

export function buildSampleExpiryReport(data: SampleReportDataset, filters: SampleReportFilters = {}, at = new Date().toISOString(), nearExpiryDays = DEFAULT_NEAR_EXPIRY_DISPLAY_DAYS) {
  const skus = byId(data.skus), now = new Date(at).getTime();
  return data.batches.filter(item => (!filters.sampleSkuId || item.sampleSkuId === filters.sampleSkuId) && (!filters.status || item.status === filters.status)).map(item => { const daysRemaining = Math.floor((new Date(item.expiryDate).getTime() - now) / 86400000); const category = item.status === "BLOCKED" ? "BLOCKED" : item.status === "EXPIRED" || daysRemaining < 0 ? "EXPIRED" : daysRemaining <= nearExpiryDays ? "NEAR_EXPIRY" : "ACTIVE"; return { sampleSkuId: item.sampleSkuId, sampleName: skus.get(item.sampleSkuId)?.name || item.sampleSkuId, batchId: item.id, batchNumber: item.batchNumber, expiryDate: item.expiryDate, availableQuantity: item.availableQuantity, status: item.status, daysRemaining, category, blockedReason: (item as SampleBatch & { blockedReason?: string }).blockedReason || "" }; });
}

export function buildSampleMovementReport(data: SampleReportDataset, filters: SampleReportFilters = {}) {
  const skus = byId(data.skus), products = byId(data.products), allocations = byId(data.allocations), distributions = byId(data.distributions), users = byId(data.users);
  return data.movements.filter(item => (!filters.sampleSkuId || item.sampleSkuId === filters.sampleSkuId) && (!filters.batchId || item.batchId === filters.batchId) && (!filters.movementType || item.type === filters.movementType) && inDateRange(item.createdAt, filters)).map(item => { const sku = skus.get(item.sampleSkuId), allocation = allocations.get(item.sourceId), distribution = distributions.get(item.sourceId); return { movementId: item.id, createdAt: item.createdAt, type: item.type, sampleSkuId: item.sampleSkuId, sampleName: sku?.name || item.sampleSkuId, productId: sku?.productId || "", productName: nameOf(products, sku?.productId), batchId: item.batchId || "", quantity: item.quantity, actorId: item.actorId, actor: nameOf(users, item.actorId), sourceType: item.sourceType, sourceId: item.sourceId, repId: allocation?.repId || distribution?.repId || "", physicianId: distribution?.physicianId || "", notes: item.notes || "", flags: [item.type === "ADJUSTMENT" ? "ADJUSTMENT" : "", !item.sourceId ? "MISSING_SOURCE_REFERENCE" : ""].filter(Boolean).join(", ") }; });
}

export function buildSampleExecutiveSummary(data: SampleReportDataset, filters: SampleReportFilters = {}) {
  const inventory = buildSampleInventoryReport(data, filters), requests = buildSampleRequestLifecycleReport(data, filters), balances = buildRepresentativeBalanceReport(data, filters), distributions = buildSampleDistributionReport(data, filters), expiry = buildSampleExpiryReport(data, filters);
  return { activeSampleSkus: data.skus.filter(item => item.active && item.status === "ACTIVE").length, centralAvailableStock: inventory.reduce((sum, item) => sum + item.availableQuantity, 0), pendingRequests: requests.filter(item => item.status === "PENDING_APPROVAL").length, pendingApprovals: requests.filter(item => item.status === "PENDING_APPROVAL").length, awaitingAllocation: requests.filter(item => item.status === "AWAITING_ALLOCATION").length, partiallyAllocated: requests.filter(item => item.status === "PARTIALLY_ALLOCATED").length, representativeAvailableBalance: balances.reduce((sum, item) => sum + item.currentRemaining, 0), totalDistributions: distributions.reduce((sum, item) => sum + item.quantity, 0), physiciansReceivingSamples: new Set(distributions.map(item => item.physicianId)).size, nearExpiryBatches: expiry.filter(item => item.category === "NEAR_EXPIRY").length, expiredOrBlockedBatches: expiry.filter(item => item.category === "EXPIRED" || item.category === "BLOCKED").length };
}
