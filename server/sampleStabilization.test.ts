import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStandaloneSampleRequestInput, standaloneSampleRequestId, visitSampleRequestId } from "./sampleRequestService";
import { parseSampleAllocationCommand, parseSampleReceiptCommand, parseSampleVariantCommand } from "./sampleMutationService";
import { CANONICAL_USER_ROLES, Role } from "../src/types";
import { getDefaultSampleCapabilities, hasSampleCapability } from "../src/lib/sampleAuthorization";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("FIX 5B.3B-S2 canonical Samples stabilization contracts", () => {
  it("allows general stock requests without physician and preserves strong idempotency", () => {
    expect(parseStandaloneSampleRequestInput({ idempotencyKey: "token", physicianId: "PHY-1", sampleSkuId: "SKU-1", quantity: 2, reason: "Need", urgent: false })).toBeTruthy();
    expect(parseStandaloneSampleRequestInput({ idempotencyKey: "token", sampleSkuId: "SKU-1", quantity: 2, reason: "Need", urgent: false })).toBeTruthy();
    expect(parseStandaloneSampleRequestInput({ idempotencyKey: "token", physicianId: "PHY-1", sampleSkuId: "SKU-1", quantity: 2, reason: "Need", expectedDeliveryDate: "bad", urgent: false })).toBeNull();
  });

  it("derives stable, route-separated request identities", () => {
    expect(standaloneSampleRequestId("REP", "TOKEN")).toBe(standaloneSampleRequestId("REP", "TOKEN"));
    expect(standaloneSampleRequestId("REP", "TOKEN")).not.toBe(standaloneSampleRequestId("REP", "OTHER"));
    expect(visitSampleRequestId("VIS", "SKU", "INTENT")).toBe(visitSampleRequestId("VIS", "SKU", "INTENT"));
    expect(visitSampleRequestId("VIS", "SKU", "INTENT")).not.toBe(standaloneSampleRequestId("VIS", "SKU"));
  });

  it("strictly parses allocation, variant and receipt commands", () => {
    expect(parseSampleAllocationCommand({ idempotencyKey: "A", repId: "R", sampleSkuId: "S", quantity: 1 })).toBeTruthy();
    expect(parseSampleAllocationCommand({ idempotencyKey: "A", repId: "R", sampleSkuId: "S", quantity: 0 })).toBeNull();
    expect(parseSampleVariantCommand({ action: "CREATE", idempotencyKey: "V", productId: "P", name: "Trial", descriptor: "10mg" })).toBeTruthy();
    expect(parseSampleVariantCommand({ action: "UPDATE", idempotencyKey: "VU", sampleSkuId: "S", productId: "P", name: "Trial", descriptor: "20mg" })).toBeTruthy();
    expect(parseSampleVariantCommand({ action: "REACTIVATE", idempotencyKey: "VR", sampleSkuId: "S" })).toBeTruthy();
    expect(parseSampleVariantCommand({ action: "CREATE", idempotencyKey: "V", productId: "P", name: "", descriptor: "10mg" })).toBeNull();
    expect(parseSampleReceiptCommand({ idempotencyKey: "X", sampleSkuId: "S", batchNumber: "B", expiryDate: "2030-01-01", quantity: 4 })).toBeTruthy();
    expect(parseSampleReceiptCommand({ idempotencyKey: "X", sampleSkuId: "S", batchNumber: "B", expiryDate: "bad", quantity: 4 })).toBeNull();
  });

  it("enforces frozen creator and managerial allocator roles", () => {
    for (const role of CANONICAL_USER_ROLES) {
      const user = { role };
      expect(hasSampleCapability(user, "CREATE_SAMPLE_SKU", { sampleCapabilities: { CREATE_SAMPLE_SKU: true } } as any)).toBe([Role.SUPER_ADMIN, Role.ADMIN].includes(role));
      if ([Role.WAREHOUSE_MANAGER, Role.INVENTORY_OFFICER, Role.STORE_MANAGER].includes(role)) expect(hasSampleCapability(user, "ALLOCATE_SAMPLE_STOCK", { sampleCapabilities: { ALLOCATE_SAMPLE_STOCK: true } } as any)).toBe(false);
    }
  });

  it("excludes exactly the five frozen roles from module defaults", () => {
    const excluded = [Role.ORDER_OPS_OFFICER, Role.FINANCE_MANAGER, Role.FINANCE, Role.TREASURY_OFFICER, Role.DELIVERY_OFFICER];
    for (const role of CANONICAL_USER_ROLES) expect(getDefaultSampleCapabilities(role).VIEW_SAMPLE_MANAGEMENT).toBe(!excluded.includes(role));
  });

  it("keeps physical receipt custody separate from representatives and managers", () => {
    for (const role of [Role.WAREHOUSE_MANAGER, Role.INVENTORY_OFFICER, Role.STORE_MANAGER]) expect(getDefaultSampleCapabilities(role).RECEIVE_SAMPLE_STOCK).toBe(true);
    for (const role of [Role.MEDICAL_REP, Role.MEDICAL_SUPERVISOR, Role.MEDICAL_MANAGER]) expect(getDefaultSampleCapabilities(role).RECEIVE_SAMPLE_STOCK).toBe(false);
  });

  it("coordinates Visit request creation inside the Visit transaction", () => {
    const visit = source("./physicianVisitWriteService.ts");
    expect(visit).toContain("visitSampleRequestId");
    expect(visit).toContain('tx.create(db.collection("sampleRequests")');
    expect(visit).toContain("canonicalAdditionalRequests");
    expect(visit).toContain("requestIds");
    expect(visit).toContain("approvalIds");
    expect(visit).toContain("writeCommandHash");
    expect(visit).toContain("replayed: true");
  });

  it("removes browser operational mutation and off-visit distribution authority", () => {
    const allocation = source("../src/components/samples/SampleAllocation.tsx"), inventory = source("../src/components/samples/SampleInventory.tsx"), requests = source("../src/components/samples/SampleRequests.tsx"), server = source("../server.ts");
    expect(allocation).toContain("allocateSampleStock"); expect(allocation).not.toContain("allocateCanonicalSampleStock");
    expect(inventory).toContain("mutateSampleVariant"); expect(inventory).toContain("receiveSampleStock");
    expect(requests).toContain("createAuthorizedSampleRequest"); expect(requests).not.toContain("persistCanonicalSampleRequest(newReq)");
    expect(server).toContain("SAMPLE_DISTRIBUTION_REQUIRES_PHYSICIAN_VISIT");
  });

  it("proposes authoritative Rules without deploying them", () => {
    const rules = source("../firestore.rules");
    for (const marker of ["match /sampleRequests", "match /sampleAllocations", "match /sampleCatalog"]) expect(rules).toContain(marker);
    expect(rules).toContain("Allocation and consumption are authoritative backend transactions");
    expect(rules).toContain("allow create, update: if false;");
  });
});
