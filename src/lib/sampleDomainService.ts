import type {
  RepresentativeSampleBalance,
  SampleAllocation,
  SampleApproval,
  SampleApprovalDecision,
  SampleDistribution,
  SampleInventoryMovement,
  SampleInventoryMovementSourceType,
  SampleInventoryMovementType,
  SampleRequest,
  SampleRequestSource,
  SampleSku
} from "../types";

export class SampleDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SampleDomainError";
  }
}

export interface SampleSkuCreationAuthorization {
  canCreateSampleSku: boolean;
}

export interface CreateSampleSkuInput {
  id: string;
  productId: string;
  name: string;
  descriptor: string;
  unitSize?: string;
  unitsPerPack?: number;
  coldChain?: boolean;
  manufacturer?: string;
  notes?: string;
  actorId: string;
  occurredAt: string;
}

export interface CreateSampleRequestInput {
  id: string;
  repId: string;
  sampleSkuId: string;
  productId: string;
  quantityRequested: number;
  reason: string;
  requestedForPhysicianId?: string;
  visitId?: string;
  source: SampleRequestSource;
  urgent: boolean;
  occurredAt: string;
}

export interface DecideSampleRequestInput {
  approvalId: string;
  request: SampleRequest;
  approverId: string;
  decision: SampleApprovalDecision;
  approvedQuantity?: number;
  reason?: string;
  rejectionReason?: string;
  occurredAt: string;
}

export interface CreateSampleAllocationInput {
  id: string;
  sampleSku: SampleSku;
  repId: string;
  quantityAllocated: number;
  batchId?: string;
  inventoryMovementId?: string;
  requestId?: string;
  approvalId?: string;
  allocatedBy: string;
  allocatedAt: string;
}

export interface ValidateSampleDistributionInput {
  sampleSku: SampleSku;
  allocation: SampleAllocation;
  repId: string;
  physicianId: string;
  quantity: number;
  physicianAllowanceRemaining: number;
  batchUsable?: boolean;
}

export interface RecordSampleDistributionInput extends ValidateSampleDistributionInput {
  id: string;
  createdBy: string;
  distributedAt: string;
  visitId?: string;
  requestId?: string;
  notes?: string;
  movementId: string;
}

function requireCanonicalId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new SampleDomainError("MISSING_CANONICAL_ID", `${field} is required.`);
  }
  return normalized;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new SampleDomainError("INVALID_QUANTITY", `${field} must be a positive integer.`);
  }
  return value;
}

function deriveReportingMonth(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(isoDate) && !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new SampleDomainError("INVALID_TIMESTAMP", "allocatedAt must be an ISO date or timestamp.");
  }
  return isoDate.slice(0, 7);
}

export function resolveSampleSkuById(sampleSkus: readonly SampleSku[], sampleSkuId: string): SampleSku | undefined {
  const canonicalId = requireCanonicalId(sampleSkuId, "sampleSkuId");
  return sampleSkus.find(sampleSku => sampleSku.id === canonicalId);
}

export function listSampleSkusForProduct(sampleSkus: readonly SampleSku[], productId: string): SampleSku[] {
  const canonicalProductId = requireCanonicalId(productId, "productId");
  return sampleSkus.filter(sampleSku => sampleSku.productId === canonicalProductId);
}

export function createSampleSku(
  input: CreateSampleSkuInput,
  canonicalProductIds: ReadonlySet<string>,
  authorization: SampleSkuCreationAuthorization
): SampleSku {
  if (!authorization.canCreateSampleSku) {
    throw new SampleDomainError("SAMPLE_SKU_CREATE_FORBIDDEN", "The operator cannot create Sample SKUs.");
  }
  const productId = requireCanonicalId(input.productId, "productId");
  if (!canonicalProductIds.has(productId)) {
    throw new SampleDomainError("CANONICAL_PRODUCT_NOT_FOUND", `Product ${productId} does not exist.`);
  }
  const id = requireCanonicalId(input.id, "id");
  const actorId = requireCanonicalId(input.actorId, "actorId");
  if (!input.name.trim() || !input.descriptor.trim()) {
    throw new SampleDomainError("INVALID_SAMPLE_SKU", "Sample SKU name and descriptor are required.");
  }
  if (input.unitsPerPack !== undefined) requirePositiveInteger(input.unitsPerPack, "unitsPerPack");

  return {
    id,
    productId,
    name: input.name.trim(),
    descriptor: input.descriptor.trim(),
    status: "ACTIVE",
    active: true,
    unitSize: input.unitSize,
    unitsPerPack: input.unitsPerPack,
    coldChain: input.coldChain,
    manufacturer: input.manufacturer,
    notes: input.notes,
    createdAt: input.occurredAt,
    createdBy: actorId,
    updatedAt: input.occurredAt,
    updatedBy: actorId
  };
}

export function createSampleRequest(input: CreateSampleRequestInput, sampleSku: SampleSku): SampleRequest {
  const sampleSkuId = requireCanonicalId(input.sampleSkuId, "sampleSkuId");
  const productId = requireCanonicalId(input.productId, "productId");
  if (sampleSku.id !== sampleSkuId || sampleSku.productId !== productId) {
    throw new SampleDomainError("SAMPLE_SKU_PRODUCT_MISMATCH", "Sample SKU and Product IDs do not match.");
  }
  if (!sampleSku.active || sampleSku.status !== "ACTIVE") {
    throw new SampleDomainError("SAMPLE_SKU_INACTIVE", "Requests require an active Sample SKU.");
  }
  if (!input.reason.trim()) {
    throw new SampleDomainError("REQUEST_REASON_REQUIRED", "A Sample Request reason is required.");
  }

  return {
    id: requireCanonicalId(input.id, "id"),
    requesterId: requireCanonicalId(input.repId, "repId"),
    repId: input.repId.trim(),
    sampleSkuId,
    productId,
    quantityRequested: requirePositiveInteger(input.quantityRequested, "quantityRequested"),
    reason: input.reason.trim(),
    requestedForPhysicianId: input.requestedForPhysicianId?.trim() || undefined,
    visitId: input.visitId?.trim() || undefined,
    source: input.source,
    urgent: input.urgent,
    status: "PENDING_APPROVAL",
    createdAt: input.occurredAt,
    createdBy: input.repId.trim()
  };
}

export function decideSampleRequest(input: DecideSampleRequestInput): {
  approval: SampleApproval;
  request: SampleRequest;
} {
  if (input.request.status !== "PENDING_APPROVAL") {
    throw new SampleDomainError("REQUEST_NOT_PENDING", "Only pending Sample Requests can be decided.");
  }
  const approvedQuantity = input.decision === "APPROVED"
    ? requirePositiveInteger(input.approvedQuantity ?? input.request.quantityRequested, "approvedQuantity")
    : 0;
  if (approvedQuantity > input.request.quantityRequested) {
    throw new SampleDomainError("APPROVED_QUANTITY_EXCEEDED", "Approved quantity cannot exceed requested quantity.");
  }
  if (input.decision === "REJECTED" && !input.rejectionReason?.trim()) {
    throw new SampleDomainError("REJECTION_REASON_REQUIRED", "Rejected Sample Requests require a reason.");
  }
  const approverId = requireCanonicalId(input.approverId, "approverId");
  const approval: SampleApproval = {
    id: requireCanonicalId(input.approvalId, "approvalId"),
    requestId: input.request.id,
    approverId,
    decision: input.decision,
    approvedQuantity,
    reason: input.reason?.trim() || undefined,
    rejectionReason: input.rejectionReason?.trim() || undefined,
    decidedAt: input.occurredAt,
    createdAt: input.occurredAt,
    createdBy: approverId
  };
  return {
    approval,
    request: {
      ...input.request,
      status: input.decision === "APPROVED" ? "AWAITING_ALLOCATION" : "REJECTED",
      updatedAt: input.occurredAt,
      updatedBy: approverId
    }
  };
}

export function createSampleAllocation(input: CreateSampleAllocationInput): SampleAllocation {
  const quantityAllocated = requirePositiveInteger(input.quantityAllocated, "quantityAllocated");
  const allocatedBy = requireCanonicalId(input.allocatedBy, "allocatedBy");
  return {
    id: requireCanonicalId(input.id, "id"),
    sampleSkuId: requireCanonicalId(input.sampleSku.id, "sampleSku.id"),
    productId: requireCanonicalId(input.sampleSku.productId, "sampleSku.productId"),
    repId: requireCanonicalId(input.repId, "repId"),
    quantityAllocated,
    quantityDistributed: 0,
    quantityRemaining: quantityAllocated,
    batchId: input.batchId,
    inventoryMovementId: input.inventoryMovementId,
    requestId: input.requestId,
    approvalId: input.approvalId,
    allocatedAt: input.allocatedAt,
    allocatedBy,
    status: "ACTIVE",
    reportingMonth: deriveReportingMonth(input.allocatedAt),
    createdAt: input.allocatedAt,
    createdBy: allocatedBy
  };
}

export function calculateRepresentativeSampleBalance(
  allocations: readonly SampleAllocation[],
  repId: string,
  sampleSku: SampleSku
): RepresentativeSampleBalance {
  const matching = allocations.filter(allocation =>
    allocation.repId === repId &&
    allocation.sampleSkuId === sampleSku.id &&
    allocation.productId === sampleSku.productId &&
    allocation.status !== "CANCELLED"
  );
  return matching.reduce<RepresentativeSampleBalance>((balance, allocation) => ({
    ...balance,
    allocatedQuantity: balance.allocatedQuantity + allocation.quantityAllocated,
    distributedQuantity: balance.distributedQuantity + allocation.quantityDistributed,
    availableQuantity: balance.availableQuantity + allocation.quantityRemaining
  }), {
    repId,
    sampleSkuId: sampleSku.id,
    productId: sampleSku.productId,
    allocatedQuantity: 0,
    distributedQuantity: 0,
    availableQuantity: 0
  });
}

export function validateSampleDistributionEligibility(input: ValidateSampleDistributionInput): void {
  requirePositiveInteger(input.quantity, "quantity");
  requireCanonicalId(input.physicianId, "physicianId");
  if (!input.sampleSku.active || input.sampleSku.status !== "ACTIVE") {
    throw new SampleDomainError("SAMPLE_SKU_INACTIVE", "Distribution requires an active Sample SKU.");
  }
  if (input.allocation.sampleSkuId !== input.sampleSku.id || input.allocation.productId !== input.sampleSku.productId) {
    throw new SampleDomainError("ALLOCATION_SAMPLE_MISMATCH", "Allocation does not reference the selected Sample SKU and Product.");
  }
  if (input.allocation.repId !== input.repId || input.allocation.status !== "ACTIVE") {
    throw new SampleDomainError("ALLOCATION_NOT_USABLE", "Representative has no usable matching allocation.");
  }
  if (input.batchUsable === false) {
    throw new SampleDomainError("BATCH_NOT_USABLE", "The selected Sample batch is blocked or expired.");
  }
  if (input.quantity > input.allocation.quantityRemaining) {
    throw new SampleDomainError("INSUFFICIENT_REP_SAMPLE_BALANCE", "Distribution exceeds representative available Sample balance.");
  }
  if (input.quantity > input.physicianAllowanceRemaining) {
    throw new SampleDomainError("PHYSICIAN_ALLOWANCE_EXCEEDED", "Distribution exceeds physician Sample allowance.");
  }
}

export function createSampleInventoryMovement(input: {
  id: string;
  sampleSkuId: string;
  batchId?: string;
  type: SampleInventoryMovementType;
  quantity: number;
  sourceId: string;
  sourceType: SampleInventoryMovementSourceType;
  actorId: string;
  createdAt: string;
  notes?: string;
}): SampleInventoryMovement {
  if (!Number.isInteger(input.quantity) || input.quantity === 0) {
    throw new SampleDomainError("INVALID_MOVEMENT_QUANTITY", "Inventory movement quantity must be a non-zero integer.");
  }
  return {
    ...input,
    id: requireCanonicalId(input.id, "id"),
    sampleSkuId: requireCanonicalId(input.sampleSkuId, "sampleSkuId"),
    sourceId: requireCanonicalId(input.sourceId, "sourceId"),
    actorId: requireCanonicalId(input.actorId, "actorId")
  };
}

export function recordSampleDistribution(input: RecordSampleDistributionInput): {
  distribution: SampleDistribution;
  allocation: SampleAllocation;
  movement: SampleInventoryMovement;
} {
  validateSampleDistributionEligibility(input);
  const quantityRemaining = input.allocation.quantityRemaining - input.quantity;
  const distribution: SampleDistribution = {
    id: requireCanonicalId(input.id, "id"),
    sampleSkuId: input.sampleSku.id,
    productId: input.sampleSku.productId,
    repId: input.repId,
    physicianId: input.physicianId,
    quantity: input.quantity,
    allocationId: input.allocation.id,
    visitId: input.visitId,
    requestId: input.requestId,
    batchId: input.allocation.batchId,
    distributedAt: input.distributedAt,
    createdBy: requireCanonicalId(input.createdBy, "createdBy"),
    notes: input.notes
  };
  return {
    distribution,
    allocation: {
      ...input.allocation,
      quantityDistributed: input.allocation.quantityDistributed + input.quantity,
      quantityRemaining,
      status: quantityRemaining === 0 ? "DEPLETED" : "ACTIVE",
      updatedAt: input.distributedAt,
      updatedBy: input.createdBy
    },
    movement: createSampleInventoryMovement({
      id: input.movementId,
      sampleSkuId: input.sampleSku.id,
      batchId: input.allocation.batchId,
      type: "DISTRIBUTION",
      quantity: -input.quantity,
      sourceId: distribution.id,
      sourceType: "SAMPLE_DISTRIBUTION",
      actorId: input.createdBy,
      createdAt: input.distributedAt,
      notes: input.notes
    })
  };
}
