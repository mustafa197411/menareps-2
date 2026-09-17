import type { Product, SampleAllocation, SampleSku, User } from "../types";

export interface SampleAllocationDisplayRow {
  id: string;
  repId: string;
  repName: string;
  sampleSkuId: string;
  productId: string;
  productName: string;
  brand: string;
  allocatedQuantity: number;
  distributedQuantity: number;
  remainingQuantity: number;
  month: string;
  region: string;
  allocationSource: "DIRECT" | "REQUEST";
  requestId?: string;
}

type AllocationRecord = Partial<SampleAllocation> & Record<string, unknown> & { id: string };

const text = (value: unknown): string => String(value ?? "");

export function resolveSampleAllocationDisplay(
  allocation: AllocationRecord,
  users: readonly User[],
  sampleCatalog: readonly SampleSku[],
  products: readonly Product[]
): SampleAllocationDisplayRow {
  const repId = text(allocation.repId);
  const sampleSkuId = text(allocation.sampleSkuId || allocation.productId);
  const sku = sampleCatalog.find(item => item.id === sampleSkuId);
  const productId = text(allocation.productId || sku?.productId);
  const rep = users.find(item => item.id === repId);
  const product = products.find(item => item.id === productId);
  const requestId = text(allocation.requestId) || undefined;

  return {
    id: allocation.id,
    repId,
    repName: text(rep?.name || allocation.repName || repId),
    sampleSkuId,
    productId,
    productName: text(sku?.name || allocation.productName || sampleSkuId),
    brand: text(product?.name || allocation.brand || sku?.descriptor || productId),
    allocatedQuantity: Number(allocation.quantityAllocated ?? allocation.allocatedQuantity ?? 0),
    distributedQuantity: Number(allocation.quantityDistributed ?? allocation.distributedQuantity ?? 0),
    remainingQuantity: Number(allocation.quantityRemaining ?? allocation.remainingQuantity ?? 0),
    month: text(allocation.reportingMonth || allocation.month || "—"),
    region: text(rep?.region || allocation.region || "—"),
    allocationSource: requestId ? "REQUEST" : "DIRECT",
    requestId
  };
}

export function filterSampleAllocationRows(rows: readonly SampleAllocationDisplayRow[], filters: { searchTerm: string; selectedRegion: string; selectedProduct: string; selectedMonth: string }): SampleAllocationDisplayRow[] {
  const term = text(filters.searchTerm).toLowerCase();
  const selectedRegion = text(filters.selectedRegion).toLowerCase();
  return rows.filter(row => {
    const matchesSearch = [row.repName, row.productName, row.brand, row.sampleSkuId]
      .some(value => text(value).toLowerCase().includes(term));
    const matchesRegion = filters.selectedRegion === "all" || text(row.region).toLowerCase() === selectedRegion;
    const matchesProduct = filters.selectedProduct === "all" || row.sampleSkuId === filters.selectedProduct;
    const matchesMonth = filters.selectedMonth === "all" || row.month === filters.selectedMonth;
    return matchesSearch && matchesRegion && matchesProduct && matchesMonth;
  });
}
