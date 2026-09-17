import { describe, expect, it } from "vitest";
import { Role, type Product, type SampleBatch, type SampleSku, type User, type UserProductAssignment } from "../types";
import { getAuthorizedSampleUserIds } from "./sampleAuthorization";
import { chunkSampleSubjectIds } from "./sampleScopeClient";
import { deriveSampleBatchCounters, eligibleSampleCatalog, resolveSampleBusinessLabels, resolveSampleRequestContext } from "./samplePresentation";

const user = (id: string, role: Role, managerId?: string): User => ({ id, name: id, email: `${id}@test.local`, role, managerId, active: true });
const sku = (overrides: Partial<SampleSku> = {}): SampleSku => ({ id: "SKU-1", productId: "PROD-1", name: "Cardio Trial", descriptor: "10mg", status: "ACTIVE", active: true, createdAt: "2026-01-01", createdBy: "admin", updatedAt: "2026-01-01", updatedBy: "admin", ...overrides });
const product = (overrides: Partial<Product> = {}): Product => ({ id: "PROD-1", name: "Cardio", brand: "Cardio", active: true, status: "Active", ...overrides } as Product);
const assignment = { id: "UPA-1", userId: "rep", productId: "PROD-1", status: "Active", active: true } as UserProductAssignment;
const batch = (id: string, status: SampleBatch["status"], expiryDate: string, availableQuantity: number): SampleBatch => ({ id, sampleSkuId: "SKU-1", batchNumber: id, status, expiryDate, receivedQuantity: 10, availableQuantity, createdAt: "2026-01-01", createdBy: "warehouse" });

describe("FIX 5B.3B-S2 final Samples policy", () => {
  it("resolves complete descendants and chunks every authorized UID", () => {
    const users = [user("manager", Role.MEDICAL_MANAGER), user("supervisor", Role.MEDICAL_SUPERVISOR, "manager"), user("rep", Role.MEDICAL_REP, "supervisor"), user("unrelated", Role.MEDICAL_REP, "other")];
    expect(getAuthorizedSampleUserIds(users[0], users, "TEAM")).toEqual(expect.arrayContaining(["manager", "supervisor", "rep"]));
    expect(getAuthorizedSampleUserIds(users[0], users, "TEAM")).not.toContain("unrelated");
    const ids = Array.from({ length: 65 }, (_, index) => `rep-${index}`);
    expect(chunkSampleSubjectIds(ids).map(chunk => chunk.length)).toEqual([30, 30, 5]);
    expect(chunkSampleSubjectIds(ids).flat()).toHaveLength(65);
  });

  it("keeps eligible active catalog visible at zero allocation", () => {
    expect(eligibleSampleCatalog([sku()], [product()], [assignment], "rep").map(item => item.id)).toEqual(["SKU-1"]);
    expect(eligibleSampleCatalog([sku({ active: false, status: "INACTIVE" })], [product()], [assignment], "rep")).toEqual([]);
    expect(eligibleSampleCatalog([sku()], [product({ active: false })], [assignment], "rep")).toEqual([]);
  });

  it("renders stable business labels and explicit request context", () => {
    expect(resolveSampleBusinessLabels({ sampleSkuId: "SKU-1", productId: "PROD-1" }, [sku()], [product()])).toMatchObject({ sampleName: "Cardio Trial", productName: "Cardio" });
    expect(resolveSampleRequestContext({ source: "STANDALONE" } as any).physicianLabel).toBe("General Stock Request");
    expect(resolveSampleRequestContext({ source: "PHYSICIAN_VISIT", visitId: "VIS-1", requestedForPhysicianName: "Dr Lina" } as any)).toMatchObject({ physicianLabel: "Dr Lina", visitId: "VIS-1" });
  });

  it("derives coherent active, total and usable batch counters", () => {
    const counters = deriveSampleBatchCounters([batch("A", "AVAILABLE", "2030-01-01", 39), batch("B", "BLOCKED", "2030-01-01", 20), batch("C", "AVAILABLE", "2020-01-01", 10), batch("D", "DEPLETED", "2030-01-01", 0)], "2026-08-25");
    expect(counters).toMatchObject({ totalBatches: 4, activeBatches: 1, blockedBatches: 1, expiredBatches: 1, usableAvailableQuantity: 39 });
  });
});
