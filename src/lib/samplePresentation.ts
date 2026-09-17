import type { Product, SampleBatch, SampleRequest, SampleSku, UserProductAssignment } from "../types";

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const active = (row: any): boolean => row && row.isDeleted !== true && row.active !== false && row.isActive !== false && !["INACTIVE", "DISCONTINUED", "ARCHIVED"].includes(text(row.status).toUpperCase());

export function eligibleSampleCatalog(
  catalog: readonly SampleSku[],
  products: readonly Product[],
  assignments: readonly UserProductAssignment[],
  representativeId: string,
): SampleSku[] {
  const activeProducts = new Set(products.filter(active).map(product => product.id));
  const assignedProducts = new Set(assignments.filter(row => row.userId === representativeId && active(row) && text(row.status).toUpperCase() === "ACTIVE").map(row => row.productId));
  return catalog.filter(sku => active(sku) && sku.status === "ACTIVE" && activeProducts.has(sku.productId) && assignedProducts.has(sku.productId));
}

export function resolveSampleBusinessLabels(record: Record<string, unknown>, catalog: readonly SampleSku[], products: readonly Product[]) {
  const sampleSkuId = text(record.sampleSkuId);
  const sku = catalog.find(item => item.id === sampleSkuId);
  const productId = text(record.productId) || sku?.productId || "";
  const product = products.find(item => item.id === productId);
  return {
    sampleSkuId,
    productId,
    sampleName: text(sku?.name) || text(record.sampleSkuName) || "Sample variant unavailable",
    productName: text(product?.name) || text(record.productName) || "Product unavailable",
    descriptor: text(sku?.descriptor) || text(record.descriptor),
  };
}

export function resolveSampleRequestContext(request: SampleRequest) {
  const visitLinked = request.source === "PHYSICIAN_VISIT";
  return {
    sourceLabel: visitLinked ? "Physician Visit" : "Standalone Stock Request",
    physicianLabel: visitLinked ? (request.requestedForPhysicianName || "Physician snapshot unavailable") : "General Stock Request",
    visitId: visitLinked ? request.visitId : undefined,
  };
}

export function deriveSampleBatchCounters(batches: readonly SampleBatch[], today: string) {
  const canonical = batches.filter(batch => (batch as SampleBatch & { isDeleted?: boolean }).isDeleted !== true);
  const classified = canonical.map(batch => {
    const expired = batch.expiryDate.slice(0, 10) < today || batch.status === "EXPIRED";
    const blocked = batch.status === "BLOCKED";
    const active = !expired && !blocked && batch.status === "AVAILABLE" && Number(batch.availableQuantity) > 0;
    return { batch, expired, blocked, active, usableQuantity: active ? Math.max(0, Number(batch.availableQuantity)) : 0 };
  });
  return {
    totalBatches: classified.length,
    activeBatches: classified.filter(item => item.active).length,
    expiredBatches: classified.filter(item => item.expired).length,
    blockedBatches: classified.filter(item => item.blocked).length,
    usableAvailableQuantity: classified.reduce((sum, item) => sum + item.usableQuantity, 0),
  };
}
