import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Role } from "./types";
import type { SampleAllocation, SampleBatch, SampleSku } from "./types";
import { getDefaultSampleCapabilities } from "./lib/sampleAuthorization";
import { calculateRepresentativeSampleBalance } from "./lib/sampleDomainService";
import { consumeAllocationsFefo, SampleStockError, validateDistributionEligibility } from "./lib/sampleStockService";

const now = "2026-08-13T20:00:00.000Z";
const sku: SampleSku = { id: "S399", productId: "PROD-2551", name: "Panadol - Trial", descriptor: "Trial", status: "ACTIVE", active: true, createdAt: now, createdBy: "admin" };
const allocation = (repId = "rep-1", remaining = 20): SampleAllocation => ({ id: "AL-1", repId, sampleSkuId: sku.id, productId: sku.productId, quantityAllocated: 20, quantityDistributed: 20 - remaining, quantityRemaining: remaining, batchId: "B1", allocatedAt: now, allocatedBy: "admin", status: remaining ? "ACTIVE" : "DEPLETED", reportingMonth: "2026-08", createdAt: now, createdBy: "admin" });
const batch: SampleBatch = { id: "B1", sampleSkuId: sku.id, batchNumber: "MK120", expiryDate: "2027-08-01", receivedQuantity: 50, availableQuantity: 30, status: "AVAILABLE", createdAt: now, createdBy: "inventory" };

describe("DEF-WP76E-03 canonical representative Sample allocation resolution", () => {
  it("separates managerial allocation authority from physical stock custody", () => {
    expect(getDefaultSampleCapabilities(Role.SUPER_ADMIN).ALLOCATE_SAMPLE_STOCK).toBe(true);
    expect(getDefaultSampleCapabilities(Role.WAREHOUSE_MANAGER).ALLOCATE_SAMPLE_STOCK).toBe(false);
    expect(getDefaultSampleCapabilities(Role.INVENTORY_OFFICER).ALLOCATE_SAMPLE_STOCK).toBe(false);
    expect(getDefaultSampleCapabilities(Role.STORE_MANAGER).ALLOCATE_SAMPLE_STOCK).toBe(false);
    expect(getDefaultSampleCapabilities(Role.MEDICAL_MANAGER).ALLOCATE_SAMPLE_STOCK).toBe(true);
    expect(getDefaultSampleCapabilities(Role.MEDICAL_SUPERVISOR).ALLOCATE_SAMPLE_STOCK).toBe(true);
    expect(getDefaultSampleCapabilities(Role.MEDICAL_REP).ALLOCATE_SAMPLE_STOCK).toBe(false);
  });

  it("resolves Panadol by canonical representative UID and Sample SKU", () => {
    expect(calculateRepresentativeSampleBalance([allocation()], "rep-1", sku)).toMatchObject({ productId: "PROD-2551", sampleSkuId: "S399", availableQuantity: 20 });
    expect(calculateRepresentativeSampleBalance([allocation()], "rep-2", sku).availableQuantity).toBe(0);
  });

  it("permits positive allocation and blocks zero allocation", () => {
    expect(validateDistributionEligibility({ sampleSku: sku, allocations: [allocation()], batches: [batch], distributions: [], repId: "rep-1", physicianId: "PHY-1", quantity: 1, at: now }).allowed).toBe(true);
    expect(validateDistributionEligibility({ sampleSku: sku, allocations: [], batches: [batch], distributions: [], repId: "rep-1", physicianId: "PHY-1", quantity: 1, at: now })).toMatchObject({ allowed: false, availableRepQuantity: 0, stockReasonCode: "INSUFFICIENT_REP_STOCK" });
  });

  it("plans a canonical decrement without crossing representatives", () => {
    expect(consumeAllocationsFefo([allocation()], [batch], "rep-1", "S399", 2, now)).toEqual([{ allocationId: "AL-1", batchId: "B1", quantity: 2 }]);
    expect(() => consumeAllocationsFefo([allocation()], [batch], "rep-2", "S399", 1, now)).toThrowError(SampleStockError);
  });

  it("preserves expiry and monthly cap enforcement", () => {
    expect(validateDistributionEligibility({ sampleSku: sku, allocations: [allocation()], batches: [{ ...batch, expiryDate: "2026-08-12" }], distributions: [], repId: "rep-1", physicianId: "PHY-1", quantity: 1, at: now }).allowed).toBe(false);
    expect(validateDistributionEligibility({ sampleSku: sku, allocations: [allocation()], batches: [batch], distributions: [{ id: "D1", sampleSkuId: "S399", productId: "PROD-2551", repId: "rep-1", physicianId: "PHY-1", quantity: 2, allocationId: "AL-1", distributedAt: now, createdBy: "rep-1" }], repId: "rep-1", physicianId: "PHY-1", quantity: 1, monthlyLimit: 2, at: now })).toMatchObject({ allowed: false, stockReasonCode: "PHYSICIAN_ALLOWANCE_EXCEEDED" });
  });

  it("uses the canonical visit transaction fields and deterministic retry IDs", () => {
    const source = fs.readFileSync(new URL("./lib/firestoreService.ts", import.meta.url), "utf8");
    const visitPersistence = source.slice(source.indexOf("export async function savePhysicianVisitRecord"), source.indexOf("export async function savePharmacyVisitRecord"));
    expect(visitPersistence).toContain("allocDoc.data.quantityRemaining");
    expect(visitPersistence).toContain("quantityDistributed: currentDist + consumption.quantity");
    expect(visitPersistence).toContain('doc(db, "sampleDisbursedLogs", distributionId)');
    expect(visitPersistence).toContain('type: "DISTRIBUTION"');
    expect(visitPersistence).toContain("DIST-${visitId.replace");
    expect(visitPersistence).not.toContain("allocData.remainingQuantity");
  });
});
