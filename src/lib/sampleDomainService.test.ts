import { describe, expect, it } from "vitest";
import type { PhysicianVisit, SampleAllocation, SampleSku } from "../types";
import {
  SampleDomainError,
  calculateRepresentativeSampleBalance,
  createSampleAllocation,
  createSampleRequest,
  createSampleSku,
  decideSampleRequest,
  listSampleSkusForProduct,
  recordSampleDistribution,
  resolveSampleSkuById
} from "./sampleDomainService";

const occurredAt = "2026-08-08T12:00:00.000Z";
const productIds = new Set(["PROD-7964"]);

function sampleSku(id = "SAMPLE-TEST4-TRIAL"): SampleSku {
  return createSampleSku({
    id,
    productId: "PROD-7964",
    name: "Test 4 - Trial",
    descriptor: "Trial",
    actorId: "ADMIN-1",
    occurredAt
  }, productIds, { canCreateSampleSku: true });
}

function allocation(sku = sampleSku()): SampleAllocation {
  return createSampleAllocation({
    id: "ALLOC-1",
    sampleSku: sku,
    repId: "REP-1",
    quantityAllocated: 10,
    allocatedBy: "INVENTORY-1",
    allocatedAt: occurredAt
  });
}

describe("WP-S3 canonical Samples domain foundation", () => {
  it("1. requires a canonical Product ID when creating a Sample SKU", () => {
    expect(() => createSampleSku({
      id: "SAMPLE-1", productId: "", name: "Trial", descriptor: "Trial",
      actorId: "ADMIN-1", occurredAt
    }, productIds, { canCreateSampleSku: true })).toThrowError(SampleDomainError);
    expect(() => createSampleSku({
      id: "SAMPLE-1", productId: "Test 4", name: "Trial", descriptor: "Trial",
      actorId: "ADMIN-1", occurredAt
    }, productIds, { canCreateSampleSku: true })).toMatchErrorCode("CANONICAL_PRODUCT_NOT_FOUND");
  });

  it("2. supports multiple Sample SKUs linked to the same Product ID", () => {
    const trial = sampleSku("SAMPLE-TRIAL");
    const starter = sampleSku("SAMPLE-STARTER");
    expect(listSampleSkusForProduct([trial, starter], "PROD-7964").map(item => item.id))
      .toEqual(["SAMPLE-TRIAL", "SAMPLE-STARTER"]);
  });

  it("3. resolves Sample SKUs by ID only and never by display name", () => {
    const sku = sampleSku();
    expect(resolveSampleSkuById([sku], sku.id)).toBe(sku);
    expect(resolveSampleSkuById([sku], sku.name)).toBeUndefined();
  });

  it("4. never treats Product commercial stock as Sample stock", () => {
    const sku = sampleSku();
    const commercialProduct = { id: sku.productId, stock: 500, stockQuantity: 500 };
    expect(calculateRepresentativeSampleBalance([], "REP-1", sku).availableQuantity).toBe(0);
    expect(commercialProduct.stock).toBe(500);
  });

  it("5. request creation does not change representative balance", () => {
    const sku = sampleSku();
    const before = calculateRepresentativeSampleBalance([], "REP-1", sku);
    const request = createSampleRequest({
      id: "REQ-1", repId: "REP-1", sampleSkuId: sku.id, productId: sku.productId,
      quantityRequested: 5, reason: "Field need", source: "STANDALONE", urgent: false, occurredAt
    }, sku);
    const after = calculateRepresentativeSampleBalance([], "REP-1", sku);
    expect(request.status).toBe("PENDING_APPROVAL");
    expect(after).toEqual(before);
  });

  it("6. approval moves the request to awaiting allocation without changing balance", () => {
    const sku = sampleSku();
    const request = createSampleRequest({
      id: "REQ-1", repId: "REP-1", sampleSkuId: sku.id, productId: sku.productId,
      quantityRequested: 5, reason: "Field need", source: "STANDALONE", urgent: false, occurredAt
    }, sku);
    const result = decideSampleRequest({
      approvalId: "APP-1", request, approverId: "MANAGER-1", decision: "APPROVED",
      approvedQuantity: 5, occurredAt
    });
    expect(result.request.status).toBe("AWAITING_ALLOCATION");
    expect(result.approval.approvedQuantity).toBe(5);
    expect(calculateRepresentativeSampleBalance([], "REP-1", sku).availableQuantity).toBe(0);
  });

  it("7. allocation is the lifecycle event that creates usable rep balance", () => {
    const sku = sampleSku();
    const created = allocation(sku);
    expect(calculateRepresentativeSampleBalance([created], "REP-1", sku).availableQuantity).toBe(10);
  });

  it("8. distribution reduces representative available balance", () => {
    const sku = sampleSku();
    const created = allocation(sku);
    const result = recordSampleDistribution({
      id: "DIST-1", movementId: "MOVE-1", sampleSku: sku, allocation: created,
      repId: "REP-1", physicianId: "PHY-2", quantity: 4,
      physicianAllowanceRemaining: 5, createdBy: "REP-1", distributedAt: occurredAt
    });
    expect(result.allocation.quantityRemaining).toBe(6);
    expect(result.allocation.quantityDistributed).toBe(4);
    expect(result.movement.quantity).toBe(-4);
  });

  it("9. rejects distribution greater than representative balance", () => {
    const sku = sampleSku();
    expect(() => recordSampleDistribution({
      id: "DIST-1", movementId: "MOVE-1", sampleSku: sku, allocation: allocation(sku),
      repId: "REP-1", physicianId: "PHY-1", quantity: 11,
      physicianAllowanceRemaining: 20, createdBy: "REP-1", distributedAt: occurredAt
    })).toMatchErrorCode("INSUFFICIENT_REP_SAMPLE_BALANCE");
  });

  it("10. allocation preserves Sample SKU and canonical Product references", () => {
    const sku = sampleSku();
    expect(allocation(sku)).toMatchObject({ sampleSkuId: sku.id, productId: "PROD-7964" });
  });

  it("11. derives reporting month from allocation date and contains no region", () => {
    const created = allocation();
    expect(created.reportingMonth).toBe("2026-08");
    expect("region" in created).toBe(false);
  });

  it("12. intended physician is metadata and does not lock the recipient", () => {
    const sku = sampleSku();
    const request = createSampleRequest({
      id: "REQ-1", repId: "REP-1", sampleSkuId: sku.id, productId: sku.productId,
      quantityRequested: 2, reason: "Requested for physician A", requestedForPhysicianId: "PHY-A",
      source: "STANDALONE", urgent: false, occurredAt
    }, sku);
    const result = recordSampleDistribution({
      id: "DIST-1", movementId: "MOVE-1", sampleSku: sku, allocation: allocation(sku),
      repId: "REP-1", physicianId: "PHY-B", quantity: 1, physicianAllowanceRemaining: 5,
      requestId: request.id, createdBy: "REP-1", distributedAt: occurredAt
    });
    expect(request.requestedForPhysicianId).toBe("PHY-A");
    expect(result.distribution.physicianId).toBe("PHY-B");
  });

  it("13. rejects Sample SKU/Product mismatches through canonical IDs", () => {
    const sku = sampleSku();
    expect(() => createSampleRequest({
      id: "REQ-1", repId: "REP-1", sampleSkuId: sku.id, productId: "PROD-OTHER",
      quantityRequested: 1, reason: "Need", source: "STANDALONE", urgent: false, occurredAt
    }, sku)).toMatchErrorCode("SAMPLE_SKU_PRODUCT_MISMATCH");
  });

  it("14. centrally denies Sample SKU creation without authorization", () => {
    expect(() => createSampleSku({
      id: "SAMPLE-1", productId: "PROD-7964", name: "Trial", descriptor: "Trial",
      actorId: "REP-1", occurredAt
    }, productIds, { canCreateSampleSku: false })).toMatchErrorCode("SAMPLE_SKU_CREATE_FORBIDDEN");
  });

  it("15. leaves the existing no-sample Physician Visit contract unaffected", () => {
    const visit: PhysicianVisit = {
      id: "VIS-1", physicianId: "PHY-1", physicianName: "Physician", repId: "REP-1",
      repName: "Rep", visitDate: "2026-08-08", durationSeconds: 60, detailing: [], samples: [],
      additionalSampleRequests: [], prescriptionIntent: 5, generalNotes: "", gpsVerified: true,
      createdAt: occurredAt
    };
    expect(visit.samples).toEqual([]);
    expect(visit.additionalSampleRequests).toEqual([]);
  });
});

declare module "vitest" {
  interface Assertion<T = unknown> {
    toMatchErrorCode(code: string): T;
  }
}

expect.extend({
  toMatchErrorCode(received: () => unknown, expectedCode: string) {
    try {
      received();
      return { pass: false, message: () => `Expected function to throw ${expectedCode}.` };
    } catch (error) {
      const code = error instanceof SampleDomainError ? error.code : undefined;
      return {
        pass: code === expectedCode,
        message: () => `Expected error code ${expectedCode}, received ${code ?? "unknown"}.`
      };
    }
  }
});
