import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createHotspot, HotspotError, parseHotspotMutation, recordHotspotInteraction } from "./hotspotService";

function memoryDb(seed: Record<string, Record<string, any>>) {
  const rows = new Map(Object.entries(seed).flatMap(([collection, values]) => Object.entries(values).map(([id, value]) => [`${collection}/${id}`, value]))), auto = { value: 0 };
  const snapshot = (path: string) => ({ id: path.split("/").pop()!, exists: rows.has(path), data: () => rows.get(path), ref: reference(path) });
  function reference(path: string): any { return { id: path.split("/").pop()!, path, get: async () => snapshot(path), create: async (value: any) => { if (rows.has(path)) throw new Error("exists"); rows.set(path, value); }, update: async (value: any) => rows.set(path, { ...rows.get(path), ...value }) }; }
  function collection(name: string): any {
    const filters: Array<[string, unknown]> = [];
    const query: any = { where(field: string, _op: string, value: unknown) { filters.push([field, value]); return query; }, async get() { return { docs: [...rows.entries()].filter(([path, row]) => path.startsWith(`${name}/`) && filters.every(([field, value]) => row[field] === value)).map(([path]) => snapshot(path)) }; }, doc(id?: string) { return reference(`${name}/${id || `AUTO-${++auto.value}`}`); } };
    return query;
  }
  const db: any = { collection, async runTransaction(callback: any) { const tx = { get: (target: any) => target.get(), create: (ref: any, value: any) => ref.create(value), update: (ref: any, value: any) => ref.update(value) }; return callback(tx); } };
  return { db, rows };
}

const mutation = { productId: "P-1", pageNumber: 2, hotspotName: "Efficacy", hotspotType: "KEY_MESSAGE", xPercent: 10, yPercent: 20, widthPercent: 30, heightPercent: 25, linkedKeyMessageId: "KM-1", description: "Approved message" };
const resource = { resourceId: "RES-1", titleEn: "Material", mimeType: "application/pdf", active: true, uploadStatus: "COMPLETE", approvalStatus: "PUBLISHED", resourceScope: "SELECTED_PRODUCTS", productIds: ["P-1"], promotionGroupId: "PG-1", specialtyIds: ["SPEC-1"], effectiveDate: "2026-01-01", expiryDate: "2026-12-31", storagePath: "resources/PG-1/RES-1/v2/file.pdf", fileVersion: 2 };
const product = { id: "P-1", active: true, promotionGroupId: "PG-1" };

describe("Fix 5 trusted hotspot lifecycle", () => {
  it("accepts only bounded mutation fields and geometry", () => {
    expect(parseHotspotMutation(mutation)).toMatchObject(mutation);
    expect(parseHotspotMutation({ ...mutation, actorUid: "forged" })).toBeNull();
    expect(parseHotspotMutation({ ...mutation, xPercent: 90, widthPercent: 20 })).toBeNull();
    expect(parseHotspotMutation({ ...mutation, pageNumber: 0 })).toBeNull();
  });

  it.each(["Medical Manager", "Sales & Marketing Manager", "Medical Representative"])("denies hotspot management to %s", async role => {
    const store = memoryDb({ users: { U: { role, active: true } }, rolePermissions: { [role]: { resourceCapabilities: { manage: true } } } });
    await expect(createHotspot("U", "RES-1", mutation, store.db)).rejects.toMatchObject({ code: "HOTSPOT_ROLE_DENIED", status: 403 });
  });

  it("creates a server-owned version-bound definition for Super Admin", async () => {
    const store = memoryDb({ users: { SA: { role: "Super Admin", active: true } }, rolePermissions: { "Super Admin": {} }, academicResources: { "RES-1": resource }, products: { "P-1": product }, keyMessages: { "KM-1": { id: "KM-1", productId: "P-1", active: true, isApproved: true } }, detailingHotspotDefinitions: {}, userProductAssignments: {} });
    const result = await createHotspot("SA", "RES-1", mutation, store.db, () => new Date("2026-08-28T12:00:00Z"));
    expect(result.hotspot).toMatchObject({ materialId: "RES-1", productId: "P-1", promotionGroupId: "PG-1", resourceVersion: 2, version: 1, createdByUid: "SA" });
    expect(result.hotspot).not.toHaveProperty("actorUid");
  });

  it("allows Admin with the existing capability and denies it when missing", async () => {
    const base = { academicResources: { "RES-1": resource }, products: { "P-1": product }, keyMessages: {}, detailingHotspotDefinitions: {}, userProductAssignments: {} };
    const allowed = memoryDb({ ...base, users: { A: { role: "Admin", active: true } }, rolePermissions: { Admin: { resourceCapabilities: { manage: true } } } });
    await expect(createHotspot("A", "RES-1", { ...mutation, linkedKeyMessageId: undefined }, allowed.db)).resolves.toHaveProperty("hotspot.resourceVersion", 2);
    const denied = memoryDb({ ...base, users: { A: { role: "Admin", active: true } }, rolePermissions: { Admin: { resourceCapabilities: { manage: false } } } });
    await expect(createHotspot("A", "RES-1", { ...mutation, linkedKeyMessageId: undefined }, denied.db)).rejects.toMatchObject({ code: "HOTSPOT_CAPABILITY_DENIED" });
  });

  it("allows an assigned PM on selected Products and never infers group-wide ownership", async () => {
    const common = { users: { PM: { role: "Product Manager", active: true } }, rolePermissions: { "Product Manager": { resourceCapabilities: { manage: true } } }, products: { "P-1": product }, keyMessages: {}, detailingHotspotDefinitions: {}, userProductAssignments: { PA: { userId: "PM", productId: "P-1", productGroupId: "PG-1", active: true, status: "Active" } } };
    const selected = memoryDb({ ...common, academicResources: { "RES-1": resource } });
    await expect(createHotspot("PM", "RES-1", { ...mutation, linkedKeyMessageId: undefined }, selected.db)).resolves.toHaveProperty("hotspot.productId", "P-1");
    const group = memoryDb({ ...common, academicResources: { "RES-1": { ...resource, resourceScope: "PROMOTION_GROUP", productIds: [] } } });
    await expect(createHotspot("PM", "RES-1", { ...mutation, linkedKeyMessageId: undefined }, group.db)).rejects.toMatchObject({ code: "RESOURCE_PROMOTION_GROUP_OWNERSHIP_REQUIRED", status: 403 });
  });

  it("rejects duplicate active names transactionally", async () => {
    const store = memoryDb({ users: { SA: { role: "Super Admin", active: true } }, rolePermissions: { "Super Admin": {} }, academicResources: { "RES-1": resource }, products: { "P-1": product }, keyMessages: { "KM-1": { productId: "P-1", active: true, isApproved: true } }, detailingHotspotDefinitions: { OLD: { materialId: "RES-1", pageNumber: 2, hotspotName: " efficacy ", active: true } }, userProductAssignments: {} });
    await expect(createHotspot("SA", "RES-1", mutation, store.db)).rejects.toMatchObject({ code: "HOTSPOT_DUPLICATE", status: 409 });
  });

  it("records only server-derived visit interaction dimensions", async () => {
    const store = memoryDb({
      users: { REP: { role: "Medical Representative", active: true } }, rolePermissions: { "Medical Representative": {} },
      physicians: { PHY: { id: "PHY", active: true, areaId: "AREA", specialtyId: "SPEC-1", primaryPromotionGroupId: "PG-1" } },
      userTerritoryAssignments: { TA: { userId: "REP", areaId: "AREA", active: true, status: "Active" } }, userProductAssignments: { PA: { userId: "REP", productId: "P-1", productGroupId: "PG-1", active: true, status: "Active" } }, products: { "P-1": product },
      physicianVisitContexts: { CTX: { contextId: "CTX", visitId: "VIS-1", representativeUid: "REP", physicianId: "PHY", visitDate: "2026-08-28", status: "ACTIVE", expiresAt: "2026-08-28T16:00:00Z" } }, academicResources: { "RES-1": resource },
      detailingHotspotDefinitions: { HOT: { hotspotId: "HOT", materialId: "RES-1", resourceVersion: 2, productId: "P-1", promotionGroupId: "PG-1", pageNumber: 2, active: true, version: 3, linkedKeyMessageId: "KM-1" } }, keyMessages: { "KM-1": { productId: "P-1", active: true, isApproved: true, targetSpecialtyIds: ["SPEC-1"] } }, detailingHotspotInteractions: {},
    });
    const result = await recordHotspotInteraction("REP", "RES-1", "HOT", { contextId: "CTX", productId: "P-1" }, store.db, () => new Date("2026-08-28T12:00:00Z"));
    const event = store.rows.get(`detailingHotspotInteractions/${result.interactionId}`);
    expect(event).toMatchObject({ resourceId: "RES-1", resourceVersion: 2, hotspotId: "HOT", hotspotVersion: 3, productId: "P-1", promotionGroupId: "PG-1", keyMessageId: "KM-1", visitId: "VIS-1", physicianId: "PHY", physicianSpecialtyId: "SPEC-1", representativeUid: "REP", interactionType: "ACTIVATE" });
  });

  it("keeps all direct definition and interaction access denied", () => {
    const rules = fs.readFileSync("firestore.rules", "utf8");
    expect(rules).toMatch(/match \/detailingHotspotDefinitions\/{hotspotId}[\s\S]*?allow read, write: if false/);
    expect(rules).toMatch(/match \/detailingHotspotInteractions\/{interactionId}[\s\S]*?allow read, write: if false/);
  });
});
