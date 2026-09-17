import { defaultOfferScopeDependencies } from "./offerAdministrationService";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFirestoreCommercialMarketRegistryRepository } from "./commercialMarketRegistryRepository";
import { readOfferProductOptions, readOfferRepresentativeOptions, type OfferAdministrationRepository } from "./offerAdministrationService";
import { isReportingAncestor, type OrganizationalUser, type ReportingDescendantRepository } from "./organizationalHierarchyService";
import { Role } from "../src/types";

const actor = (role: Role) => ({ uid: "ROOT", role, permissions: { offerCapabilities: { "offers.create": true, "offers.view": true } } });
function products(records: Array<{ id: string; data: Record<string, unknown> }>) {
  const query = { orderBy: vi.fn(() => query), limit: vi.fn(() => query), get: vi.fn(async () => ({ docs: records.map(row => ({ id: row.id, data: () => row.data })) })) };
  const db = { collection: vi.fn(() => query) };
  return { repository: createFirestoreCommercialMarketRegistryRepository(db as never), db };
}
function hierarchy(records: OrganizationalUser[]): ReportingDescendantRepository {
  return {
    getUser: async id => records.find(row => row.id === id) || null,
    getDirectReportsPage: async (id, after, limit) => records.filter(row => row.managerId === id && (!after || row.id > after)).sort((a,b) => a.id.localeCompare(b.id)).slice(0, limit),
    getContinuation: async () => null,
    advanceContinuation: async (current, replacement) => { expect(current).toBeUndefined(); expect(replacement).toBeUndefined(); },
  };
}
const root = (role: Role, managerId?: string): OrganizationalUser => ({ id: "ROOT", role, ...(managerId === undefined ? {} : { managerId }), active: true });
const rep: OrganizationalUser = { id: "REP", role: Role.SALES_REP, managerId: "ROOT", active: true };
const offerRepository = {} as OfferAdministrationRepository;

describe("Offer Product candidate identity integration", () => {
  it.each([Role.SALES_MANAGER, Role.SALES_MARKETING_MANAGER, Role.SUPER_ADMIN])("loads document-ID Products for %s without representative assignments", async role => {
    const rows = [{ id: "P-A", data: { id: "P-A", name: "First", price: 1, isActive: true } }, { id: "P-B", data: { productId: "P-B", name: "Valid tier Product", price: 70, active: true } }];
    const f = products(rows);
    expect((await readOfferProductOptions(actor(role), f.repository)).products.map(p => p.id)).toEqual(["P-A", "P-B"]);
    expect(f.db.collection.mock.calls).toEqual([["products"]]);
    expect(rows[0].data).not.toHaveProperty("productId");
  });
  it.each([{ productId: "OTHER" }, { id: "OTHER" }, { productId: null }])("rejects explicit identity conflict %j", async patch => {
    const f = products([{ id: "P", data: { name: "Product", price: 1, ...patch } }]);
    await expect(readOfferProductOptions(actor(Role.SALES_MANAGER), f.repository)).rejects.toThrow("COMMERCIAL_REGISTRY_DOCUMENT_ID_MISMATCH");
  });
  it("keeps unrelated commercial registry identifiers strict", async () => {
    await expect(products([{ id: "CO", data: { name: "Company" } }]).repository.readCompanies({ limit: 100 })).rejects.toThrow("COMMERCIAL_REGISTRY_DOCUMENT_ID_MISMATCH");
  });
  it.each([{ active: false }, { isActive: false }, { status: "Inactive" }, { marketingStatus: "Inactive" }, { isDeleted: true }])("excludes inactive Products %j", async patch => {
    expect((await readOfferProductOptions(actor(Role.ADMIN), products([{ id: "P", data: { name: "Product", price: 1, ...patch } }]).repository)).products).toEqual([]);
  });
  it.each([null, "70", -1, Infinity])("does not hide invalid active Product price %s", async price => {
    await expect(readOfferProductOptions(actor(Role.ADMIN), products([{ id: "P", data: { name: "Product", price } }]).repository)).rejects.toMatchObject({ code: "OFFER_PRODUCT_DISPLAY_INVALID" });
  });
  it("rejects unauthorized role before reading Products", async () => {
    const f = products([]);
    await expect(readOfferProductOptions(actor(Role.SALES_REP), f.repository)).rejects.toMatchObject({ code: "OFFER_PERMISSION_DENIED" });
    expect(f.db.collection).not.toHaveBeenCalled();
  });
});

describe("Offer bounded representative candidate integration", () => {
  it.each([undefined, "", null])("permits established top-level no-manager representation %s", async managerId => {
    const r = { ...root(Role.SUPER_ADMIN), managerId } as OrganizationalUser;
    const repo = hierarchy([r, rep, { ...rep, id: "INACTIVE", active: false }, { ...rep, id: "MED", role: Role.MEDICAL_REP }, { ...rep, id: "OUTSIDE", managerId: "ELSEWHERE" }]);
    expect((await readOfferRepresentativeOptions(actor(Role.SUPER_ADMIN), {}, offerRepository, repo)).representatives.map(p => p.id)).toEqual(["REP"]);
    expect(r.managerId).toBe(managerId);
    expect(await isReportingAncestor("ROOT", "REP", repo)).toBe(true);
    expect(await isReportingAncestor("ROOT", "OUTSIDE", repo)).toBe(false);
  });
  it.each([Role.SALES_MANAGER, Role.SALES_MARKETING_MANAGER])("preserves valid %s hierarchy", async role => {
    expect((await readOfferRepresentativeOptions(actor(role), {}, offerRepository, hierarchy([root(role, "PARENT"), { id: "PARENT", role: Role.SUPER_ADMIN }, rep]))).representatives.map(p => p.id)).toEqual(["REP"]);
  });
  it.each(["", null, "ROOT", " ", "BAD/ID"])("rejects malformed non-top-level manager %s", async managerId => {
    await expect(readOfferRepresentativeOptions(actor(Role.SALES_MANAGER), {}, offerRepository, hierarchy([{ ...root(Role.SALES_MANAGER), managerId } as OrganizationalUser, rep]))).rejects.toMatchObject({ code: "HIERARCHY_MALFORMED" });
  });
  it.each(["ROOT", " ", "BAD/ID"])("does not exempt top-level invalid nonempty manager %s", async managerId => {
    await expect(readOfferRepresentativeOptions(actor(Role.SUPER_ADMIN), {}, offerRepository, hierarchy([root(Role.SUPER_ADMIN, managerId), rep]))).rejects.toMatchObject({ code: "HIERARCHY_MALFORMED" });
  });
  it("rejects cycles and missing traversal users", async () => {
    await expect(readOfferRepresentativeOptions(actor(Role.SUPER_ADMIN), {}, offerRepository, hierarchy([root(Role.SUPER_ADMIN, "REP"), rep]))).rejects.toMatchObject({ code: "HIERARCHY_MALFORMED" });
    await expect(readOfferRepresentativeOptions(actor(Role.SUPER_ADMIN), {}, offerRepository, hierarchy([]))).rejects.toMatchObject({ code: "HIERARCHY_MALFORMED" });
    expect(await isReportingAncestor("ROOT", "REP", hierarchy([{ ...rep, managerId: "MISSING" }]))).toBe(false);
  });
  it("does not grant candidate discovery to unauthorized roles", async () => {
    await expect(readOfferRepresentativeOptions(actor(Role.SALES_REP), {}, offerRepository, hierarchy([root(Role.SALES_REP), rep]))).rejects.toMatchObject({ code: "OFFER_PERMISSION_DENIED" });
  });
});

beforeEach(() => {
  vi.spyOn(defaultOfferScopeDependencies, "resolveScope").mockImplementation(async uid => ({ authorized: true, actorUid: uid, productIds: ["P", "P-A", "P-B"], productGroupIds: [], queryPlan: { denyAll: false } } as any));
  vi.spyOn(defaultOfferScopeDependencies, "readMarket").mockResolvedValue({ status: "UNRESOLVED" });
});

it("ALL Products is restricted at runtime without rewriting the stored definition", async () => {
  const { restrictOfferProducts } = await import("./offerAdministrationService");
  const definition: any = { createdBy: "CREATOR", updatedBy: "EDITOR", makerAudit: [{ actorId: "EDITOR" }], productScope: { mode: "ALL_PRODUCTS", productIds: [] }, benefit: { kind: "PRODUCT_PERCENTAGE" } };
  const scope: any = { productIds: ["P1"], productGroupIds: [] };
  const before = structuredClone(definition);
  expect(restrictOfferProducts(definition, scope, ["P1", "P2"])?.productScope).toEqual({ mode: "SELECTED_PRODUCTS", productIds: ["P1"] });
  expect(restrictOfferProducts(definition, scope, ["P2"])).toBeNull();
  expect(definition).toEqual(before);
});
