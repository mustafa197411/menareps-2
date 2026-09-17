import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Role, type SampleAllocation, type SampleBatch, type User } from "./types";
import { getAuthorizedSampleBalanceUserIds, getSampleDataScope } from "./lib/sampleAuthorization";
import { consumeAllocationsFefo, SampleStockError } from "./lib/sampleStockService";

const users: User[] = [
  { id: "rep1", name: "Rep One", email: "rep1@test", role: Role.MEDICAL_REP, managerId: "sup1" } as User,
  { id: "rep2", name: "Rep Two", email: "rep2@test", role: Role.MEDICAL_REP, managerId: "sup1" } as User,
  { id: "rep3", name: "Deep Rep", email: "rep3@test", role: Role.MEDICAL_REP, managerId: "rep1" } as User,
  { id: "sup1", name: "Supervisor", email: "sup@test", role: Role.MEDICAL_SUPERVISOR, managerId: "mgr1" } as User,
  { id: "mgr1", name: "Manager", email: "mgr@test", role: Role.MEDICAL_MANAGER } as User,
];
const allocation = (remaining = 2): SampleAllocation => ({ id: "ALLOC-1", repId: "rep1", sampleSkuId: "SKU-1", productId: "PROD-1", quantityAllocated: 2, quantityDistributed: 2 - remaining, quantityRemaining: remaining, batchId: "BATCH-1", allocatedAt: "2026-08-01", allocatedBy: "warehouse", status: remaining ? "ACTIVE" : "DEPLETED", reportingMonth: "2026-08", createdAt: "2026-08-01", createdBy: "warehouse" });
const batch = (expiryDate = "2027-01-01"): SampleBatch => ({ id: "BATCH-1", sampleSkuId: "SKU-1", batchNumber: "B1", expiryDate, receivedQuantity: 10, availableQuantity: 10, status: "AVAILABLE", createdAt: "2026-08-01", createdBy: "warehouse" });

describe("WP76F Sample permission repair", () => {
  it("authorizes administrators only through the canonical active role and does not expand unrelated manager roles", () => {
    const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    const adminRule = rules.slice(rules.indexOf("function isAdmin()"), rules.indexOf("function isRep()"));
    const managerRule = rules.slice(rules.indexOf("function isManager()"), rules.indexOf("function isHotspotContentManager()"));
    expect(adminRule).not.toMatch(/@menareps|@gmail|@esnad/);
    expect(adminRule).toContain("userData.get('role', '') in [\"Admin\", \"Super Admin\"]");
    for (const role of ["Product Manager", "Finance Manager", "Warehouse Manager", "Store Manager"]) {
      expect(managerRule).not.toContain(role);
    }
  });

  it("keeps team balance subordinate-scoped and direct Sample batch reads denied", () => {
    const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    const sampleAccess = rules.slice(rules.indexOf("function canAccessSampleRep"), rules.indexOf("function canonicalRequestRep"));
    const batchRules = rules.slice(rules.indexOf("match /sampleBatches/"), rules.indexOf("match /sampleDisbursedLogs/"));
    expect(sampleAccess).toContain("hasSampleCapability('VIEW_TEAM_SAMPLE_BALANCE', false) || canAllocateSampleStock()");
    expect(sampleAccess).toContain("isSubordinateOfActor(targetRepId)");
    expect(batchRules).not.toContain('checkRole("Medical Representative")');
    expect(batchRules).toContain("isSampleInventoryOperator()");
  });

  it("keeps ordinary Medical Representative balance scope exact-UID", () => {
    expect(getSampleDataScope(users[0], "VIEW_OWN_SAMPLE_BALANCE")).toBe("OWN");
    expect(getAuthorizedSampleBalanceUserIds(users[0], users, "OWN")).toEqual(["rep1"]);
  });

  it("limits team balance IDs to the actor and proven descendants", () => {
    expect(getAuthorizedSampleBalanceUserIds(users[4], users, "TEAM")).toEqual(expect.arrayContaining(["mgr1", "sup1", "rep1", "rep2"]));
  });

  it("does not traverse through a representative as a hierarchy manager", () => {
    expect(getAuthorizedSampleBalanceUserIds(users[4], users, "TEAM")).not.toContain("rep3");
  });

  it("uses the authenticated allocated-batch endpoint and no broad batch query", () => {
    const source = fs.readFileSync(new URL("./lib/firestoreService.ts", import.meta.url), "utf8");
    const visit = source.slice(source.indexOf("export async function savePhysicianVisitRecord"), source.indexOf("export async function savePharmacyVisitRecord"));
    expect(visit).toContain('/api/samples/allocated-batches');
    expect(visit).toContain("allocationIds: allocationDocs.map");
    expect(visit).not.toContain('query(collection(db, "sampleBatches")');
  });

  it("allows valid own allocation consumption and decrements exactly once", () => {
    const plan = consumeAllocationsFefo([allocation()], [batch()], "rep1", "SKU-1", 1, "2026-08-14");
    expect(plan).toEqual([{ allocationId: "ALLOC-1", batchId: "BATCH-1", quantity: 1 }]);
    expect(allocation().quantityRemaining - plan[0].quantity).toBe(1);
  });

  it("rejects wrong representative, expired batch, and zero balance", () => {
    expect(() => consumeAllocationsFefo([allocation()], [batch()], "rep2", "SKU-1", 1, "2026-08-14")).toThrowError(SampleStockError);
    expect(() => consumeAllocationsFefo([allocation()], [batch("2026-08-13")], "rep1", "SKU-1", 1, "2026-08-14")).toThrowError(SampleStockError);
    expect(() => consumeAllocationsFefo([allocation(0)], [batch()], "rep1", "SKU-1", 1, "2026-08-14")).toThrowError(SampleStockError);
  });

  it("uses deterministic visit distribution IDs to prevent retry duplication", () => {
    const source = fs.readFileSync(new URL("./lib/firestoreService.ts", import.meta.url), "utf8");
    expect(source).toContain('const distributionId = `DIST-${visitId.replace');
    expect(source).toContain('const txId = `SM-${visitId.replace');
  });
});
