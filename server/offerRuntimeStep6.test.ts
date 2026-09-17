import { describe, expect, it, vi } from "vitest";
import { createOfferAudienceOperation, createFirestorePharmacyOfferReadRepository, resolveOfferRuntimeCapacity } from "./pharmacyOfferReadService";
import { authoritativeProductPrice, executePharmacyVisitCompletion } from "./pharmacyVisitCompletionService";
import { parseCompletionOfferIntent } from "./pharmacyVisitOfferCompletion";
import { OFFER_CALCULATION_VERSION } from "../src/features/offers/offerCalculation";

const offer = (audienceType = "MY_SALES_TEAM", createdBy = "ROOT", audienceUserIds = ["REP"]) => ({ createdBy, eligibility: { audienceType, ...(audienceType === "SELECTED_SALES_REPRESENTATIVES" ? { audienceUserIds } : {}) } }) as any;
const users: Record<string, any> = { REP: { id: "REP", role: "Sales Representative", managerId: "MANAGER" }, MANAGER: { id: "MANAGER", role: "Sales Supervisor", managerId: "ROOT" }, ROOT: { id: "ROOT", role: "Sales Manager", managerId: "TOP" }, TOP: { id: "TOP", role: "Super Admin" } };
const intent = (offerId: string) => ({ offerId, offerVersion: 1, calculationVersion: OFFER_CALCULATION_VERSION, selected: true, confirmed: true, confirmedAt: "2026-06-01T00:00:00.000Z", inputFingerprint: "fingerprint" });

describe("Step 6 canonical audience", () => {
  it.each([
    ["ALL_SALES_REPRESENTATIVES", "UNRELATED", ["REP"], false],
    ["MY_SALES_TEAM", "MANAGER", ["REP"], true],
    ["MY_SALES_TEAM", "ROOT", ["REP"], true],
    ["MY_SALES_TEAM", "VISIBLE_ORGANIZATION_ADMIN", ["REP"], false],
    ["MY_SALES_TEAM", "REP", ["REP"], false],
    ["SELECTED_SALES_REPRESENTATIVES", "ROOT", ["REP"], true],
    ["SELECTED_SALES_REPRESENTATIVES", "ROOT", ["rep", "REP "], false],
  ])("%s creator %s exact membership %j -> %s", async (audience, creator, members, expected) => {
    const get = vi.fn(async (id: string) => users[id] || null);
    expect(await createOfferAudienceOperation("REP", get, 3000).eligible(offer(audience, creator, members))).toBe(expected);
    if (audience === "ALL_SALES_REPRESENTATIVES") expect(get).toHaveBeenCalledTimes(4);
  });
  it("rechecks a changed reporting line in a new operation", async () => {
    const operation = createOfferAudienceOperation("REP", async id => id === "REP" ? { ...users.REP, managerId: "OTHER" } : users[id] || null, 3000);
    expect(await operation.eligible(offer("SELECTED_SALES_REPRESENTATIVES"))).toBe(false);
  });
  it.each([{ active: false }, { isDeleted: true }, { status: "Suspended" }, { employmentStatus: "Suspended" }, { accountStatus: "INACTIVE" }, { loginAllowed: false }, { role: "Medical Representative" }, { id: "WRONG" }, { active: "true" }, { managerId: "REP" }])("rejects canonical candidate %j", async patch => {
    expect(await createOfferAudienceOperation("REP", async () => ({ ...users.REP, ...patch }), 3000).eligible(offer("ALL_SALES_REPRESENTATIVES"))).toBe(false);
  });
  it("allows logical lookup 3000 and throws before 3001, including cache hits", async () => {
    const get = vi.fn(async (id: string) => users[id]);
    const op = createOfferAudienceOperation("REP", get, 3000);
    for (let i = 0; i < 600; i++) expect(await op.eligible(offer("ALL_SALES_REPRESENTATIVES"))).toBe(true);
    await expect(op.eligible(offer("ALL_SALES_REPRESENTATIVES"))).rejects.toMatchObject({ code: "OFFER_DISCOVERY_CAPACITY_EXCEEDED", complete: false });
    expect(get).toHaveBeenCalledTimes(4);
  });
  it("shares ancestor reads but counts every traversal invocation", async () => {
    const get = vi.fn(async (id: string) => users[id]);
    const budget = { lookups: 0 }, op = createOfferAudienceOperation("REP", get, 3000, budget);
    await op.eligible(offer()); await op.eligible(offer());
    expect(budget.lookups).toBe(10); expect(get).toHaveBeenCalledTimes(4);
  });
  it("propagates infrastructure failure", async () => {
    await expect(createOfferAudienceOperation("REP", async () => { throw new Error("read failure"); }, 3000).eligible(offer())).rejects.toThrow("read failure");
  });
});

describe("Step 6 configuration and query", () => {
  it.each([{}, { OFFER_RUNTIME_MAX_ACTIVE_DOCUMENTS: "251", OFFER_RUNTIME_MAX_AUDIENCE_LOOKUPS: "3000" }, { OFFER_RUNTIME_MAX_ACTIVE_DOCUMENTS: "250", OFFER_RUNTIME_MAX_AUDIENCE_LOOKUPS: "3001" }])("rejects unapproved or missing configuration %j", env => expect(() => resolveOfferRuntimeCapacity(env)).toThrow());
  it("uses ACTIVE, document-ID ascending, and a 251 limit", async () => {
    const query: any = { where: vi.fn(() => query), orderBy: vi.fn(() => query), limit: vi.fn(() => query), get: vi.fn(async () => ({ docs: [] })) };
    await createFirestorePharmacyOfferReadRepository({ collection: vi.fn(() => query) } as any).queryActive(251);
    expect(query.where).toHaveBeenCalledWith("lifecycleStatus", "==", "ACTIVE");
    expect(query.orderBy.mock.calls[0][0].isEqual((await import("firebase-admin/firestore")).FieldPath.documentId())).toBe(true);
    expect(query.orderBy.mock.calls[0][1]).toBe("asc"); expect(query.limit).toHaveBeenCalledWith(251);
  });
});

describe("Step 6 price and raw completion selection", () => {
  it.each([1, 0, -0, 1.23])("accepts canonical numeric %s", price => expect(Object.is(authoritativeProductPrice(price, price), price === 0 ? 0 : price)).toBe(true));
  it.each([undefined, null, true, false, "", "1", NaN, Infinity, -Infinity, -1])("rejects invalid canonical price %s", price => expect(() => authoritativeProductPrice(price, price)).toThrow("PHARMACY_VISIT_PRODUCT_PRICE_INVALID"));
  it.each([999, 0, "1", null, undefined])("rejects stale/forged preview %s identically", preview => {
    try { authoritativeProductPrice(1, preview); throw new Error("accepted"); } catch (e) { expect(e).toMatchObject({ status: 409, code: "PHARMACY_VISIT_PRODUCT_PRICE_CHANGED" }); }
  });
  it("preserves absent/null/empty intent and validates 20", () => {
    for (const input of [undefined, null, []]) expect(parseCompletionOfferIntent(input)).toEqual([]);
    expect(parseCompletionOfferIntent(Array.from({ length: 20 }, (_, i) => intent(`O${i}`)))).toHaveLength(20);
  });
  it("rejects 21 raw entries before entry access or expensive work", async () => {
    const raw = Array(21); Object.defineProperty(raw, 0, { get() { throw new Error("entry accessed"); } });
    const db = { runTransaction: vi.fn(), collection: vi.fn() };
    await expect(executePharmacyVisitCompletion("REP", { draft: { offerIntent: raw } as any }, { db: db as any })).rejects.toMatchObject({ status: 400, code: "PHARMACY_VISIT_OFFER_SELECTION_LIMIT_EXCEEDED" });
    expect(db.runTransaction).not.toHaveBeenCalled(); expect(db.collection).not.toHaveBeenCalled();
  });
  it.each([1, 2, 20])("rejects an actual sparse hole at raw length %i before completion work", async length => {
    const raw = Array.from({ length }, (_, i) => intent(`O${i}`));
    delete raw[length - 1];
    expect(raw.length).toBe(length);
    expect(Object.hasOwn(raw, length - 1)).toBe(false);
    expect(() => parseCompletionOfferIntent(raw)).toThrow("PHARMACY_VISIT_OFFER_CONFIRMATION_REQUIRED");
    const writes = vi.fn(), scopeRead = vi.fn();
    const db = { collection: vi.fn(), runTransaction: vi.fn(async () => { writes(); }) };
    const operationalScopeRepository = { hierarchy: { getUser: scopeRead } };
    await expect(executePharmacyVisitCompletion("REP", { draft: { offerIntent: raw } as any }, { db: db as any, operationalScopeRepository: operationalScopeRepository as any }))
      .rejects.toMatchObject({ status: 400, code: "PHARMACY_VISIT_OFFER_CONFIRMATION_REQUIRED" });
    expect(scopeRead).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(raw.length).toBe(length);
    expect(Object.hasOwn(raw, length - 1)).toBe(false);
  });
  it.each([" O1", "O1 ", "O/1", "", "../O", "O\n"])("rejects malformed IDs without normalization: %j", id => expect(() => parseCompletionOfferIntent([intent(id)])).toThrow());
  it("rejects nonarrays and duplicates", () => {
    expect(() => parseCompletionOfferIntent({})).toThrow();
    expect(() => parseCompletionOfferIntent([intent("O"), intent("O")])).toThrow();
  });
});

describe("creator subtree applies to every audience with full chain integrity", () => {
  it.each(["ALL_SALES_REPRESENTATIVES", "MY_SALES_TEAM", "SELECTED_SALES_REPRESENTATIVES"])("enforces %s across creator-boundary failures", async mode => {
    for (const patch of [
      { ROOT: { ...users.ROOT, managerId: "ROOT" } },
      { REP: { ...users.REP, managerId: "REP" } },
      { ROOT: { ...users.ROOT, managerId: "REP" } },
      { TOP: { ...users.TOP, managerId: "MANAGER" } },
      { ROOT: { ...users.ROOT, managerId: "BAD/ID" } },
      { ROOT: { ...users.ROOT, managerId: "MISSING" } },
      { ROOT: { ...users.ROOT, managerId: undefined } },
      { REP: { ...users.REP, status: "Suspended" } },
      { REP: { ...users.REP, role: "Medical Representative" } },
      { REP: null },
    ]) {
      const records: any = { ...users, ...patch };
      expect(await createOfferAudienceOperation("REP", async id => records[id] || null, 3000).eligible(offer(mode))).toBe(false);
    }
    expect(await createOfferAudienceOperation("REP", async id => users[id] || null, 3000).eligible(offer(mode))).toBe(true);
  });
  it("rejects exact-read stored identity conflicts before projection", async () => {
    const repository = createFirestorePharmacyOfferReadRepository({ collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ id: "FORGED", role: "Sales Representative" }) }) }) }) } as any);
    await expect(repository.getUser("REP")).rejects.toMatchObject({ code: "HIERARCHY_MALFORMED" });
  });
});
