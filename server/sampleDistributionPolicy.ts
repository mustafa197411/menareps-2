import type { SampleAllocation, SampleBatch, SampleQuantity, SampleSku } from "../src/types";

export const MAX_SAMPLE_UNITS_PER_SKU = 3;
export const MIN_SAMPLE_SHELF_LIFE_DAYS = 60;

export class SampleDistributionPolicyError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function marketLocalDate(instant: string, timezone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new SampleDistributionPolicyError("INVALID_DISTRIBUTION_TIME", 400);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function aggregateSampleRequests(samples: SampleQuantity[]): Array<SampleQuantity & { sampleSkuId: string }> {
  const grouped = new Map<string, SampleQuantity & { sampleSkuId: string }>();
  for (const sample of samples || []) {
    const sampleSkuId = text(sample.sampleSkuId);
    if (!sampleSkuId || !Number.isInteger(sample.quantity) || sample.quantity <= 0) throw new SampleDistributionPolicyError("INVALID_SAMPLE_REQUEST", 400);
    const existing = grouped.get(sampleSkuId);
    if (existing && text(existing.productId) !== text(sample.productId)) throw new SampleDistributionPolicyError("SAMPLE_SKU_PRODUCT_MISMATCH", 400);
    grouped.set(sampleSkuId, existing ? { ...existing, quantity: existing.quantity + sample.quantity } : { ...sample, sampleSkuId });
  }
  const result = [...grouped.values()];
  if (result.some(sample => sample.quantity > MAX_SAMPLE_UNITS_PER_SKU)) throw new SampleDistributionPolicyError("SAMPLE_SKU_DISTRIBUTION_LIMIT_EXCEEDED", 409);
  return result;
}

export function physicianRollingMaximum(classification: unknown): number {
  const value = text(classification).toUpperCase();
  if (value === "A") return 40;
  if (value === "B") return 20;
  throw new SampleDistributionPolicyError("SAMPLE_CLASSIFICATION_POLICY_REQUIRED", 409);
}

export function rollingWindowStart(distributionDate: string): string {
  return addCalendarDays(distributionDate, -89);
}

export function distributedQuantityWithinRollingWindow(records: Array<Record<string, any>>, physicianId: string, distributionDate: string, timezone: string): number {
  const start = rollingWindowStart(distributionDate);
  return records.filter(record => {
    if (text(record.physicianId) !== physicianId) return false;
    if (["CANCELLED", "REJECTED"].includes(text(record.status).toUpperCase())) return false;
    if (!Number.isFinite(Number(record.quantity)) || Number(record.quantity) <= 0) return false;
    const localDate = text(record.distributionDate) || (text(record.distributedAt) ? marketLocalDate(text(record.distributedAt), timezone) : "");
    return localDate >= start && localDate <= distributionDate;
  }).reduce((sum, record) => sum + Number(record.quantity), 0);
}

export function assertRollingPhysicianLimit(input: { records: Array<Record<string, any>>; physicianId: string; classification: unknown; distributionDate: string; timezone: string; proposedQuantity: number }) {
  const used = distributedQuantityWithinRollingWindow(input.records, input.physicianId, input.distributionDate, input.timezone);
  const maximum = physicianRollingMaximum(input.classification);
  if (used + input.proposedQuantity > maximum) throw new SampleDistributionPolicyError("PHYSICIAN_ROLLING_SAMPLE_LIMIT_EXCEEDED", 409);
  return { used, projected: used + input.proposedQuantity, maximum, windowStart: rollingWindowStart(input.distributionDate) };
}

export interface CanonicalAllocationConsumption {
  allocationId: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
}

export function planRepresentativeFefo(input: { allocations: SampleAllocation[]; batches: SampleBatch[]; repId: string; sku: SampleSku; quantity: number; distributionDate: string }): CanonicalAllocationConsumption[] {
  let remaining = input.quantity;
  const batchById = new Map(input.batches.map(batch => [batch.id, batch]));
  const minimumExpiry = addCalendarDays(input.distributionDate, MIN_SAMPLE_SHELF_LIFE_DAYS);
  const eligible = input.allocations.filter(allocation => allocation.repId === input.repId && allocation.sampleSkuId === input.sku.id && allocation.productId === input.sku.productId && allocation.status === "ACTIVE" && allocation.quantityRemaining > 0 && text(allocation.batchId))
    .map(allocation => ({ allocation, batch: batchById.get(text(allocation.batchId)) }))
    .filter((entry): entry is { allocation: SampleAllocation; batch: SampleBatch } => Boolean(entry.batch))
    .filter(entry => entry.batch.sampleSkuId === input.sku.id && entry.batch.status === "AVAILABLE" && entry.batch.availableQuantity >= 0 && isCanonicalDate(entry.batch.expiryDate.slice(0, 10)) && entry.batch.expiryDate.slice(0, 10) >= minimumExpiry)
    .sort((left, right) => left.batch.expiryDate.localeCompare(right.batch.expiryDate) || left.allocation.allocatedAt.localeCompare(right.allocation.allocatedAt) || left.allocation.id.localeCompare(right.allocation.id));
  const result: CanonicalAllocationConsumption[] = [];
  for (const entry of eligible) {
    if (remaining === 0) break;
    const quantity = Math.min(remaining, entry.allocation.quantityRemaining);
    result.push({ allocationId: entry.allocation.id, batchId: entry.batch.id, batchNumber: entry.batch.batchNumber, expiryDate: entry.batch.expiryDate, quantity });
    remaining -= quantity;
  }
  if (remaining > 0) {
    const owned = input.allocations.filter(allocation => allocation.repId === input.repId && allocation.sampleSkuId === input.sku.id && allocation.status === "ACTIVE" && allocation.quantityRemaining > 0);
    if (owned.some(allocation => !text(allocation.batchId))) throw new SampleDistributionPolicyError("SAMPLE_ALLOCATION_BATCH_REQUIRED", 409);
    throw new SampleDistributionPolicyError("INSUFFICIENT_DISTRIBUTABLE_SAMPLE_STOCK", 409);
  }
  return result;
}
