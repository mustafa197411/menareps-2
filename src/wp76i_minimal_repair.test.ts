import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Role, type SampleDistribution, type User, type UserProductAssignment } from "./types";
import { createPhysicianVisitReadController, fetchScopedPhysicianVisits } from "./lib/physicianVisitReadClient";
import { canAttachSampleBatchListener, filterAuthorizedSampleDistributions } from "./lib/sampleDistributionReadPolicy";

const rep = (id: string): User => ({ id, name: id, email: `${id}@test`, role: Role.MEDICAL_REP, areaIds: ["A1"], products: ["P1"] } as User);
const assignment = (userId: string, productId = "P1"): UserProductAssignment => ({ userId, productId, status: "Active", active: true } as UserProductAssignment);
const distribution = (id: string, repId: string, productId = "P1"): SampleDistribution => ({
  id, repId, productId, physicianId: "PHY-504", sampleSkuId: "SKU-1", quantity: 1,
  allocationId: "AL-1", distributedAt: "2026-08-14T03:16:09Z", createdBy: repId,
});

describe("WP76I minimal visit-record and sample-distribution repair", () => {
  it("1. defines the exact composite index required by the scoped visit query", () => {
    const indexes = JSON.parse(fs.readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
    expect(indexes.indexes).toContainEqual({
      collectionGroup: "physicianVisits",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "repId", order: "ASCENDING" },
        { fieldPath: "visitDate", order: "ASCENDING" },
        { fieldPath: "__name__", order: "ASCENDING" },
      ],
    });
  });

  it("2. preserves backend failure as ERROR instead of READY with zero visits", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authorized: false, code: "SCOPED_PHYSICIAN_VISIT_READ_FAILED", visits: [] }), { status: 500 }));
    const controller = createPhysicianVisitReadController(user => fetchScopedPhysicianVisits(user, {}, fetchMock as typeof fetch));
    await controller.load("rep1", { getIdToken: vi.fn(async () => "token") });
    expect(controller.getState()).toMatchObject({ status: "ERROR", actorUid: "rep1", visits: [], errorCode: "SCOPED_PHYSICIAN_VISIT_READ_FAILED" });
  });

  it("3. keeps own distributions visible without requiring areaId and denies another representative", () => {
    const actor = rep("rep1");
    const result = filterAuthorizedSampleDistributions({
      actor,
      users: [actor, rep("rep2")],
      distributions: [distribution("OWN", "rep1"), distribution("OTHER", "rep2")],
      productAssignments: [assignment("rep1")],
    });
    expect(result.map(item => item.id)).toEqual(["OWN"]);
    expect(result[0]).not.toHaveProperty("areaId");
  });

  it("4. preserves representative product scope and canonical active/non-deleted filtering", () => {
    const actor = rep("rep1");
    const rows = [
      distribution("VISIBLE", "rep1"),
      distribution("WRONG_PRODUCT", "rep1", "P2"),
      { ...distribution("DELETED", "rep1"), isDeleted: true },
      { ...distribution("INACTIVE", "rep1"), active: false },
    ];
    expect(filterAuthorizedSampleDistributions({ actor, users: [actor], distributions: rows, productAssignments: [assignment("rep1")] }).map(item => item.id)).toEqual(["VISIBLE"]);
    expect(filterAuthorizedSampleDistributions({ actor, users: [actor], distributions: rows, productAssignments: [] })).toEqual([]);
  });

  it("5. prevents Medical Representatives from attaching sampleBatches", () => {
    expect(canAttachSampleBatchListener(rep("rep1"))).toBe(false);
  });

  it.each([Role.WAREHOUSE_MANAGER, Role.INVENTORY_OFFICER])("6. preserves authorized %s sampleBatches access", role => {
    expect(canAttachSampleBatchListener({ role })).toBe(true);
  });

  it("6a. retires the noncanonical Warehouse / Inventory identity", () => {
    expect(canAttachSampleBatchListener({ role: Role.WAREHOUSE_INVENTORY })).toBe(false);
  });

  it("6b. keeps Product Manager outside physical batch custody", () => {
    expect(canAttachSampleBatchListener({ role: Role.PRODUCT_MANAGER })).toBe(false);
  });

  it("7. keeps the ledger query UID-scoped and removes physician-record security classification", () => {
    const source = fs.readFileSync(new URL("./components/samples/SampleDisbursedLog.tsx", import.meta.url), "utf8");
    const scopedClient = fs.readFileSync(new URL("./lib/sampleScopeClient.ts", import.meta.url), "utf8");
    expect(source).toContain("subscribeToScopedSampleCollection(db, \"sampleDisbursedLogs\", scope, authorizedIds");
    expect(scopedClient).toContain('where("repId", "==", ids[0])');
    expect(scopedClient).toContain('where("repId", "in", ids)');
    expect(scopedClient).toContain("if (chunks.length === 0) { onRows([])");
    expect(source).toContain("filterAuthorizedSampleDistributions");
    expect(source).not.toContain("applySecurityScope");
    expect(source).toContain("fetchSampleVisitOptions");
    expect(source).not.toContain('onSnapshot(collection(db, "sampleBatches")');
  });
});
