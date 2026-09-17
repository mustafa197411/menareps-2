import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { authorizeResourceRead, createPhysicianVisitContext, discoverManagementResources, discoverVisitResources, parseSingleRange, parseVisitContextCreate, publicResourceReadError, readActiveHotspots, ResourceReadError } from "./resourceReadService";

const now = new Date("2026-08-28T12:00:00.000Z");
function fakeDb(seed: Record<string, Record<string, any>>) {
  const data = new Map(Object.entries(seed).flatMap(([collection, rows]) => Object.entries(rows).map(([id, value]) => [`${collection}/${id}`, value])));
  const snap = (path: string) => ({ id: path.split("/").pop(), exists: data.has(path), data: () => data.get(path) });
  const collection = (name: string) => {
    const filters: Array<[string, unknown]> = [];
    const query: any = {
      where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; },
      async get() { const docs = [...data.entries()].filter(([path, row]) => path.startsWith(`${name}/`) && filters.every(([field, value]) => row[field] === value)).map(([path]) => snap(path)); return { docs }; },
      doc(id: string) { const path = `${name}/${id}`; return { id, path, get: async () => snap(path), create: async (value: any) => { if (data.has(path)) throw new Error("exists"); data.set(path, value); }, update: async (value: any) => data.set(path, { ...data.get(path), ...value }) }; },
    };
    return query;
  };
  return { db: { collection } as any, data };
}
const product = { id: "P-1", name: "P1", active: true, isActive: true, promotionGroupId: "PG-1" };
const published = { resourceId: "RES-1", active: true, uploadStatus: "COMPLETE", approvalStatus: "PUBLISHED", resourceScope: "SELECTED_PRODUCTS", productIds: ["P-1"], promotionGroupId: "PG-1", specialtyIds: ["SPEC-1"], effectiveDate: "2026-01-01", expiryDate: "2026-12-31", storagePath: "resources/PG-1/RES-1/v1/file.pdf", fileVersion: 1 };

describe("Fix 4 Resource read security", () => {
  it("parses only a bounded visit-context creation request", () => {
    expect(parseVisitContextCreate({ physicianId: "PHY-1", visitDate: "2026-08-28" })).toEqual({ physicianId: "PHY-1", visitDate: "2026-08-28" });
    expect(parseVisitContextCreate({ physicianId: "PHY-1", visitDate: "2026-08-28", role: "Admin" })).toBeNull();
  });
  it.each([
    ["bytes=0-99", 1000, { start: 0, end: 99 }],
    ["bytes=500-", 1000, { start: 500, end: 999 }],
    ["bytes=-100", 1000, { start: 900, end: 999 }],
  ])("accepts a safe single range", (header, size, expected) => expect(parseSingleRange(header, size)).toEqual(expected));
  it.each(["bytes=0-1,5-6", "items=0-1", "bytes=1000-1001", "bytes=9-2", "bytes=-0"])("rejects malformed or escaping range %s", value => {
    expect(() => parseSingleRange(value, 1000)).toThrowError(expect.objectContaining({ code: "RESOURCE_BINARY_RANGE_INVALID", status: 416 }));
  });
  it("hides known-ID authorization failures", () => {
    expect(publicResourceReadError(new ResourceReadError("RESOURCE_SCOPE_DENIED", 403))).toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404, internalCode: "RESOURCE_SCOPE_DENIED" });
  });
  it("creates a server-controlled ad-hoc context only after canonical rep eligibility", async () => {
    const store = fakeDb({ users: { REP: { role: "Medical Representative", active: true, loginAllowed: true } }, rolePermissions: { "Medical Representative": {} }, physicians: { PHY: { active: true, areaId: "A-1", specialtyId: "SPEC-1", primaryPromotionGroupId: "PG-1" } }, userTerritoryAssignments: { T1: { userId: "REP", areaId: "A-1", active: true, status: "Active" } }, userProductAssignments: { PA: { assignmentId: "PA", userId: "REP", productId: "P-1", productGroupId: "PG-1", active: true, status: "Active" } }, products: { "P-1": product }, medicalPlannerVisits: {} });
    const result = await createPhysicianVisitContext("REP", { physicianId: "PHY", visitDate: "2026-08-28" }, { db: store.db, now: () => now });
    expect(result).toMatchObject({ physicianId: "PHY", kind: "AD_HOC", eligibleProductIds: ["P-1"], visitId: expect.stringMatching(/^VIS_/) });
    expect(store.data.get(`physicianVisitContexts/${result.contextId}`)).toMatchObject({ visitId: result.visitId, representativeUid: "REP", status: "ACTIVE", kind: "AD_HOC" });
  });
  it("discovers only field-ready visit resources and rechecks specialty", async () => {
    const store = fakeDb({ users: { REP: { role: "Medical Representative", active: true } }, rolePermissions: { "Medical Representative": {} }, physicians: { PHY: { active: true, areaId: "A-1", specialtyId: "SPEC-1", primaryPromotionGroupId: "PG-1" } }, userTerritoryAssignments: { T1: { userId: "REP", areaId: "A-1", active: true, status: "Active" } }, userProductAssignments: { PA: { assignmentId: "PA", userId: "REP", productId: "P-1", productGroupId: "PG-1", active: true, status: "Active" } }, products: { "P-1": product }, physicianVisitContexts: { CTX: { representativeUid: "REP", physicianId: "PHY", visitDate: "2026-08-28", status: "ACTIVE", expiresAt: "2026-08-28T16:00:00.000Z" } }, academicResources: { "RES-1": published, WRONG: { ...published, resourceId: "WRONG", specialtyIds: ["SPEC-2"] } } });
    const result = await discoverVisitResources("REP", "CTX", { db: store.db, now: () => now });
    expect(result.resourcesByProduct["P-1"].map(row => row.id)).toEqual(["RES-1"]);
    expect(result.resourcesByProduct["P-1"][0]).not.toHaveProperty("storagePath");
  });
  it("returns only current-version, current-Product hotspots for field use", async () => {
    const store = fakeDb({ users: { REP: { role: "Medical Representative", active: true } }, rolePermissions: { "Medical Representative": {} }, physicians: { PHY: { active: true, areaId: "A-1", specialtyId: "SPEC-1", primaryPromotionGroupId: "PG-1" } }, userTerritoryAssignments: { T1: { userId: "REP", areaId: "A-1", active: true, status: "Active" } }, userProductAssignments: { PA: { assignmentId: "PA", userId: "REP", productId: "P-1", productGroupId: "PG-1", active: true, status: "Active" } }, products: { "P-1": product }, physicianVisitContexts: { CTX: { visitId: "VIS-1", representativeUid: "REP", physicianId: "PHY", visitDate: "2026-08-28", status: "ACTIVE", expiresAt: "2026-08-28T16:00:00.000Z" } }, academicResources: { "RES-1": { ...published, fileVersion: 2, storagePath: "resources/PG-1/RES-1/v2/file.pdf" } }, detailingHotspotDefinitions: { CURRENT: { materialId: "RES-1", productId: "P-1", resourceVersion: 2, pageNumber: 1, active: true }, OLD: { materialId: "RES-1", productId: "P-1", resourceVersion: 1, pageNumber: 1, active: true }, WRONG: { materialId: "RES-1", productId: "P-2", resourceVersion: 2, pageNumber: 1, active: true } } });
    expect((await readActiveHotspots("REP", "RES-1", { purpose: "PHYSICIAN_VISIT", contextId: "CTX", productId: "P-1" }, 1, { db: store.db, now: () => now })).hotspots.map(row => row.hotspotId)).toEqual(["CURRENT"]);
  });
  it("allows PM Product-intersection reads but not unrelated resources", async () => {
    const store = fakeDb({ users: { PM: { role: "Product Manager", active: true } }, rolePermissions: { "Product Manager": { resourceCapabilities: { manage: true } } }, userProductAssignments: { PA: { assignmentId: "PA", userId: "PM", productId: "P-1", productGroupId: "PG-1", active: true, status: "Active" } }, products: { "P-1": product, "P-2": { ...product, id: "P-2", promotionGroupId: "PG-2" } }, academicResources: { "RES-1": published, OTHER: { ...published, resourceId: "OTHER", promotionGroupId: "PG-2", productIds: ["P-2"] } } });
    expect((await discoverManagementResources("PM", { db: store.db, now: () => now })).resources.map(row => row.id)).toEqual(["RES-1"]);
    await expect(authorizeResourceRead("PM", "OTHER", { purpose: "MANAGEMENT" }, { db: store.db, now: () => now })).rejects.toMatchObject({ code: "RESOURCE_SCOPE_DENIED" });
  });
  it("registers protected endpoints and never returns canonical object paths", () => {
    const server = fs.readFileSync("server.ts", "utf8"), service = fs.readFileSync("server/resourceReadService.ts", "utf8");
    for (const route of ["/api/resources/visit-contexts", "/api/resources/management", "/api/resources/visit/discover", "/api/resources/product/discover", "/api/resources/:resourceId/binary", "/api/resources/:resourceId/hotspots"]) expect(server).toContain(route);
    expect(server).toContain("requireFirebaseAuth");
    expect(service).toContain("storagePath: _storagePath");
    expect(service).toContain("downloadUrl: _downloadUrl");
  });
  it("keeps client direct reads closed in local Rules", () => {
    expect(fs.readFileSync("firestore.rules", "utf8")).toMatch(/match \/academicResources\/{resId}[\s\S]*?allow read: if false/);
    expect(fs.readFileSync("firestore.rules", "utf8")).toMatch(/match \/physicianVisitContexts\/{contextId}[\s\S]*?allow read, write: if false/);
    expect(fs.readFileSync("storage.rules", "utf8")).toMatch(/match \/resources\/[\s\S]*?allow read: if false/);
  });
});
