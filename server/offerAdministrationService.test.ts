import { defaultOfferScopeDependencies } from "./offerAdministrationService";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_OFFER_TYPES, type CanonicalOfferDefinition } from "../src/features/offers/types";
import { defaultOfferCapabilities, resolveOfferCapabilities } from "./offerAuthorization";
import {
  createOfferDraft as createOfferDraftService, listOffers as listOffersService, mutateOffer as mutateOfferService, OfferAdministrationError, readOffer as readOfferService, validateOfferActorProfile, createFirestoreOfferRepository, readOfferProductOptions, readOfferRepresentativeOptions, resolveOfferAdministrationActor, resolveProductConfigurationActor,
  type OfferAdministrationActor, type OfferAdministrationRepository, type OfferDraftDefinitionInput,
} from "./offerAdministrationService";
import type { ReportingDescendantRepository, OrganizationalUser, HierarchyContinuationSnapshot } from "./organizationalHierarchyService";
import { Role } from "../src/types";
import { FieldPath } from "firebase-admin/firestore";

vi.mock("./operationalScopeRepository", () => ({
  createFirestoreOperationalScopeRepository: vi.fn(() => ({})),
  resolveOperationalScopeForActor: vi.fn(),
}));
import { resolveOperationalScopeForActor } from "./operationalScopeRepository";

beforeEach(() => {
  vi.spyOn(defaultOfferScopeDependencies, "resolveScope").mockImplementation(async uid => ({ authorized: true, actorUid: uid, productIds: ["PRODUCT-1", "PRODUCT-2", "P1"], productGroupIds: [], queryPlan: { denyAll: false } } as any));
  vi.spyOn(defaultOfferScopeDependencies, "readMarket").mockResolvedValue({ status: "UNRESOLVED" });
});

const NOW = "2026-09-05T12:00:00.000Z";
const actor = (role = "Admin", overrides: Partial<OfferAdministrationActor> = {}): OfferAdministrationActor => ({
  uid: "ACTOR-1", role, permissions: null,

  ...overrides,
});

const percentageBenefit = { kind: "PRODUCT_PERCENTAGE" as const, percentage: 10, base: "ELIGIBLE_PAID_PRODUCT_LINES" as const };
const draft = (overrides: Partial<OfferDraftDefinitionInput> = {}): OfferDraftDefinitionInput => ({
  code: "OFF-TEST", name: "Test Offer", type: "PRODUCT_PERCENTAGE",
  productScope: { mode: "ALL_PRODUCTS", productIds: [] }, benefit: percentageBenefit,
  eligibility: {
    audienceType: "ALL_SALES_REPRESENTATIVES", startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-09-30T23:59:59.999Z",
  },
  stackingPolicy: { mode: "NO_STACKING", priority: 0, maximumProductOrQuantityOffersPerPaidLine: 1, maximumInvoicePercentageOffersPerInvoice: 1 },
  ...overrides,
});

class MemoryRepository implements OfferAdministrationRepository {
  private queue: Promise<void> = Promise.resolve();
  documents = new Map<string, Record<string, unknown>>();
  products = new Map<string, Record<string, unknown>>([["PRODUCT-1", { active: true, productId: "PRODUCT-1", name: "First Product", price: 11 }], ["PRODUCT-2", { active: true, productId: "PRODUCT-2", name: "Second Product", price: 22 }]]);
  listCalls = 0;
  async list(controls: { pageSize: number; cursor?: { createdAt: string; documentId: string } }) {
    this.listCalls++;
    return [...this.documents].map(([id, data]) => ({ id, data })).sort((a,b) => String(b.data.createdAt).localeCompare(String(a.data.createdAt)) || b.id.localeCompare(a.id))
      .filter(row => !controls.cursor || String(row.data.createdAt) < controls.cursor.createdAt || (row.data.createdAt === controls.cursor.createdAt && row.id < controls.cursor.documentId)).slice(0, controls.pageSize);
  }
  async get(id: string) { return this.documents.get(id) || null; }
  async create(id: string, data: CanonicalOfferDefinition) { if (this.documents.has(id)) throw new Error("exists"); this.documents.set(id, structuredClone(data) as unknown as Record<string, unknown>); }
  async transact(id: string, expectedRevision: number, mutate: (current: Record<string, unknown>) => CanonicalOfferDefinition | Promise<CanonicalOfferDefinition>) {
    let release!: () => void; const previous = this.queue; this.queue = new Promise<void>(resolve => { release = resolve; }); await previous;
    try { const current = this.documents.get(id); if (!current) throw new OfferAdministrationError("OFFER_NOT_FOUND", 404); if (current.schemaVersion === 1 && current.revision !== expectedRevision) throw new OfferAdministrationError("OFFER_STALE_REVISION", 409); const next = await mutate(structuredClone(current)); this.documents.set(id, structuredClone(next) as unknown as Record<string, unknown>); return next; }
    finally { release(); }
  }
  async getProduct(id: string) { return this.products.get(id) || null; }

}

const users = new Map<string, OrganizationalUser>([
  ["ACTOR-1", { id: "ACTOR-1", role: Role.SALES_MANAGER, managerId: "ACTOR-2", active: true }],
  ["ACTOR-2", { id: "ACTOR-2", role: Role.ADMIN, managerId: "ACTOR-3", active: true }],
  ["ACTOR-3", { id: "ACTOR-3", role: Role.SUPER_ADMIN, active: true }],
  ["REP-1", { id: "REP-1", role: Role.SALES_REP, managerId: "ACTOR-1", active: true }],
  ["OTHER", { id: "OTHER", role: Role.SUPER_ADMIN, active: true }],
]);
const hierarchy: ReportingDescendantRepository = {
  async getUser(uid) { return users.get(uid) || null; },
  async getDirectReportsPage(manager, after, limit) { return [...users.values()].filter(user => user.managerId === manager && (!after || user.id > after)).sort((a,b) => a.id.localeCompare(b.id)).slice(0,limit); },
  async getContinuation() { return null; }, async advanceContinuation() {},
};
const createOfferDraft = (user: OfferAdministrationActor, input: OfferDraftDefinitionInput, repository: OfferAdministrationRepository, options: { id?: string; now?: string } = {}) =>
  createOfferDraftService(user, input, repository, hierarchy, options);
const mutateOffer = (user: OfferAdministrationActor, command: Parameters<typeof mutateOfferService>[1], repository: OfferAdministrationRepository, options: { now?: string } = {}) =>
  mutateOfferService(user, command, repository, hierarchy, options);
const listOffers = async (user: OfferAdministrationActor, repository: OfferAdministrationRepository) => (await listOffersService(user, repository, hierarchy)).offers;
const readOffer = (user: OfferAdministrationActor, id: string, repository: OfferAdministrationRepository) => readOfferService(user, id, repository, hierarchy);

const errorCode = async (work: () => Promise<unknown>) => { try { await work(); return "PASS"; } catch (error) { return (error as OfferAdministrationError).code; } };
const create = async (repository = new MemoryRepository(), input = draft(), user = actor()) => ({ repository, offer: await createOfferDraft(user, input, repository, { id: "OFFER-1", now: NOW }) });

describe("Offer Phase 2 authorization", () => {
  it("fails closed for unauthenticated, missing and inactive actors", () => {
    expect(() => validateOfferActorProfile("", {})).toThrowError(expect.objectContaining({ code: "OFFER_AUTHENTICATION_REQUIRED" }));
    expect(() => validateOfferActorProfile("UID", null)).toThrowError(expect.objectContaining({ code: "OFFER_ACTOR_NOT_FOUND" }));
    expect(() => validateOfferActorProfile("UID", { role: "Admin", active: false })).toThrowError(expect.objectContaining({ code: "OFFER_ACTOR_INACTIVE" }));
  });
  it("provides the approved creator and approver matrices", () => {
    for (const role of ["Super Admin", "Admin"]) expect(defaultOfferCapabilities(role)["offers.cancel"]).toBe(true);
    for (const role of ["Sales & Marketing Manager", "Sales Manager"]) { expect(defaultOfferCapabilities(role)["offers.create"]).toBe(true); expect(defaultOfferCapabilities(role)["offers.approve"]).toBe(role === "Sales & Marketing Manager"); }
    for (const role of ["Sales Representative", "Finance Officer", "Warehouse Manager", "Inventory Officer", "Order Operations Officer"]) expect(defaultOfferCapabilities(role)["offers.view"]).toBe(false);
    expect(defaultOfferCapabilities("Sales Representative")["offers.applyDuringVisit"]).toBe(true);
    expect(defaultOfferCapabilities("Finance Officer")["offers.applyDuringVisit"]).toBe(false);
  });
  it("allows all four creator roles to create Drafts", async () => {
    for (const role of ["Super Admin", "Admin", "Sales & Marketing Manager", "Sales Manager"]) {
      await expect(createOfferDraft(actor(role), draft(), new MemoryRepository(), { id: `OFFER-${role}`, now: NOW })).resolves.toMatchObject({ lifecycleStatus: "DRAFT", revision: 1 });
    }
  });
  it("honors restriction-only capability overrides", () => {
    expect(resolveOfferCapabilities("Admin", { offerCapabilities: { "offers.create": false } } as any)["offers.create"]).toBe(false);
    expect(resolveOfferCapabilities("Finance Officer", { offerCapabilities: { "offers.view": true } } as any)["offers.view"]).toBe(false);
  });
  it("enforces a dynamic denial on direct mutations", async () => {
    const restricted = actor("Admin", { permissions: { offerCapabilities: { "offers.create": false } } as any });
    expect(await errorCode(() => createOfferDraft(restricted, draft(), new MemoryRepository()))).toBe("OFFER_PERMISSION_DENIED");
  });
  it("denies direct service calls without capability", async () => expect(await errorCode(() => createOfferDraft(actor("Sales Representative"), draft(), new MemoryRepository()))).toBe("OFFER_PERMISSION_DENIED"));
});

describe("Offer Phase 2 creation and references", () => {
  it("creates every supported type only as canonical Draft with server fields", async () => {
    const benefits: Record<string, any> = {
      PRODUCT_PERCENTAGE: percentageBenefit,
      INVOICE_PERCENTAGE: { kind: "INVOICE_PERCENTAGE", percentage: 5, base: "PAID_ELIGIBLE_SUBTOTAL_AFTER_PRODUCT_DISCOUNTS_BEFORE_TAX", excludesFreeLines: true, excludesProductsOutsideScope: true },
      BUY_X_GET_Y: { kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", multiples: "REPEAT_COMPLETE_MULTIPLES", remainder: "NO_REWARD_BELOW_THRESHOLD" },
      TIER_BONUS: { kind: "TIER_BONUS", tiers: [{ buyQuantity: 5, freeQuantity: 1 }], reward: { mode: "SELECTED_PRODUCT", rewardProductId: "PRODUCT-2" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" },
    };
    for (const type of CANONICAL_OFFER_TYPES) {
      const result = await create(new MemoryRepository(), draft({ type, benefit: benefits[type] } as any));
      expect(result.offer).toMatchObject({ id: "OFFER-1", schemaVersion: 1, offerVersion: 1, revision: 1, lifecycleStatus: "DRAFT", createdBy: "ACTOR-1", updatedBy: "ACTOR-1" });
    }
  });
  it("accepts one and multiple canonical Selected Products", async () => {
    for (const productIds of [["PRODUCT-1"], ["PRODUCT-1", "PRODUCT-2"]]) expect((await create(new MemoryRepository(), draft({ productScope: { mode: "SELECTED_PRODUCTS", productIds } }))).offer.productScope.productIds).toEqual(productIds);
  });
  it("rejects empty selected, fixed, unknown, malformed reward and sixth tier definitions", async () => {
    const invalid = [
      draft({ productScope: { mode: "SELECTED_PRODUCTS", productIds: [] } }),
      draft({ type: "FIXED_DISCOUNT" as any }), draft({ type: "UNKNOWN" as any }),
      draft({ type: "BUY_X_GET_Y", benefit: { kind: "BUY_X_GET_Y", buyQuantity: 5, freeQuantity: 1, reward: { mode: "SELECTED_PRODUCT" }, aggregationMode: "PER_PRODUCT", multiples: "REPEAT_COMPLETE_MULTIPLES", remainder: "NO_REWARD_BELOW_THRESHOLD" } as any }),
      draft({ type: "TIER_BONUS", benefit: { kind: "TIER_BONUS", tiers: Array.from({ length: 6 }, (_, i) => ({ buyQuantity: i + 1, freeQuantity: 1 })), reward: { mode: "SAME_AS_TRIGGER" }, aggregationMode: "PER_PRODUCT", applicationMode: "REPEATING_GREEDY_WITH_REMAINDER" } }),
    ];
    for (const value of invalid) expect(await errorCode(() => createOfferDraft(actor(), value, new MemoryRepository()))).toBe("OFFER_INVALID_DEFINITION");
  });
  it("rejects a missing canonical Product", async () => {
    expect(await errorCode(() => createOfferDraft(actor(), draft({ productScope: { mode: "SELECTED_PRODUCTS", productIds: ["BAD"] } }), new MemoryRepository()))).toBe("OFFER_PRODUCT_NOT_FOUND");
  });
  it("rejects obsolete commercial eligibility fields", async () => {
    expect(await errorCode(() => createOfferDraft(actor(), draft({ eligibility: { ...draft().eligibility, companyId: "OTHER" } as any }), new MemoryRepository()))).toBe("OFFER_INVALID_DEFINITION");
  });
});

describe("Offer Phase 2 lifecycle and concurrency", () => {
  it("updates Draft transactionally and increments revision exactly once", async () => { const { repository } = await create(); const next = await mutateOffer(actor(), { action: "UPDATE_DRAFT", offerId: "OFFER-1", expectedRevision: 1, definition: draft({ name: "Changed" }) }, repository, { now: NOW }); expect(next).toMatchObject({ name: "Changed", revision: 2, createdBy: "ACTOR-1" }); });
  it("submits and returns to Draft", async () => { const { repository } = await create(); const submitted = await mutateOffer(actor(), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 1 }, repository, { now: NOW }); expect(submitted.lifecycleStatus).toBe("PENDING_APPROVAL"); const returned = await mutateOffer(actor("Admin", { uid: "ACTOR-2" }), { action: "RETURN_TO_DRAFT", offerId: "OFFER-1", expectedRevision: 2 }, repository, { now: NOW }); expect(returned).toMatchObject({ lifecycleStatus: "DRAFT", revision: 3 }); });
  it("separates creator approval and activation", async () => { const { repository } = await create(); await mutateOffer(actor(), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 1 }, repository, { now: NOW }); expect(await errorCode(() => mutateOffer(actor(), { action: "APPROVE", offerId: "OFFER-1", expectedRevision: 2 }, repository))).toBe("OFFER_MAKER_APPROVER_CONFLICT"); const approver = actor("Admin", { uid: "ACTOR-2" }); const approved = await mutateOffer(approver, { action: "APPROVE", offerId: "OFFER-1", expectedRevision: 2 }, repository, { now: NOW }); expect(approved.approvedBy).toBe("ACTOR-2"); expect(await errorCode(() => mutateOffer(actor(), { action: "ACTIVATE", offerId: "OFFER-1", expectedRevision: 3 }, repository, { now: NOW }))).toBe("OFFER_MAKER_APPROVER_CONFLICT"); expect(approved.lifecycleStatus).toBe("ACTIVE"); });
  it.each(["ACTOR-2", "ACTOR-3"])("allows historical editor/submitter ancestor %s and preserves audit history", async uid => {
    const { repository } = await create(new MemoryRepository(), draft(), actor("Sales Manager"));
    await mutateOffer(actor("Admin", { uid: "ACTOR-2" }), { action: "UPDATE_DRAFT", offerId: "OFFER-1", expectedRevision: 1, definition: draft({ name: "Edited" }) }, repository, { now: NOW });
    await mutateOffer(actor("Super Admin", { uid: "ACTOR-3" }), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 2 }, repository, { now: NOW });
    const before = structuredClone(repository.documents.get("OFFER-1"))!;
    const approved = await mutateOffer(actor(uid === "ACTOR-2" ? "Admin" : "Super Admin", { uid }), { action: "APPROVE", offerId: "OFFER-1", expectedRevision: 3 }, repository, { now: NOW });
    expect(approved).toMatchObject({ lifecycleStatus: "ACTIVE", createdBy: "ACTOR-1", approvedBy: uid, submittedBy: before.submittedBy, makerIds: before.makerIds, makerAudit: before.makerAudit });
  });
  it("requires approval before activation", async () => { const { repository } = await create(); await mutateOffer(actor(), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 1 }, repository, { now: NOW }); expect(await errorCode(() => mutateOffer(actor("Admin", { uid: "ACTOR-2" }), { action: "ACTIVATE", offerId: "OFFER-1", expectedRevision: 2 }, repository, { now: NOW }))).toBe("OFFER_INVALID_TRANSITION"); });
  it("pauses, reactivates and cancels with a reason", async () => { const { repository } = await create(); await mutateOffer(actor(), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 1 }, repository, { now: NOW }); const approver = actor("Admin", { uid: "ACTOR-2" }); await mutateOffer(approver, { action: "APPROVE", offerId: "OFFER-1", expectedRevision: 2 }, repository, { now: NOW }); await mutateOffer(approver, { action: "PAUSE", offerId: "OFFER-1", expectedRevision: 3 }, repository, { now: NOW }); await mutateOffer(approver, { action: "REACTIVATE", offerId: "OFFER-1", expectedRevision: 4 }, repository, { now: NOW }); expect(await errorCode(() => mutateOffer(approver, { action: "CANCEL", offerId: "OFFER-1", expectedRevision: 5, reason: " " }, repository))).toBe("OFFER_CANCELLATION_REASON_REQUIRED"); const cancelled = await mutateOffer(approver, { action: "CANCEL", offerId: "OFFER-1", expectedRevision: 5, reason: "Campaign withdrawn" }, repository, { now: NOW }); expect(cancelled).toMatchObject({ lifecycleStatus: "CANCELLED", cancellationReason: "Campaign withdrawn", revision: 6 }); });
  it("rejects stale revisions and preserves one authoritative winner", async () => { const { repository } = await create(); const first = mutateOffer(actor(), { action: "UPDATE_DRAFT", offerId: "OFFER-1", expectedRevision: 1, definition: draft({ name: "First" }) }, repository); const second = mutateOffer(actor(), { action: "UPDATE_DRAFT", offerId: "OFFER-1", expectedRevision: 1, definition: draft({ name: "Second" }) }, repository); const results = await Promise.allSettled([first, second]); expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(results.filter(result => result.status === "rejected")).toHaveLength(1); });
  it("does not accept client-controlled server fields", async () => { const input = { ...draft(), lifecycleStatus: "ACTIVE", revision: 99, createdBy: "CLIENT", approvedBy: "CLIENT" } as any; const { offer } = await create(new MemoryRepository(), input); expect(offer).toMatchObject({ lifecycleStatus: "DRAFT", revision: 1, createdBy: "ACTOR-1" }); expect(offer.approvedBy).toBeUndefined(); });
  it("schedules future approval, activates when due, rejects active edits and protects terminal status", async () => {
    const { repository } = await create(); const approver = actor("Admin", { uid: "ACTOR-2" });
    await mutateOffer(actor(), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 1 }, repository, { now: NOW });
    const scheduled = await mutateOffer(approver, { action: "APPROVE", offerId: "OFFER-1", expectedRevision: 2 }, repository, { now: "2026-08-01T00:00:00.000Z" });
    expect(scheduled).toMatchObject({ lifecycleStatus: "SCHEDULED", scheduledBy: "ACTOR-2", revision: 3 });
    await mutateOffer(approver, { action: "ACTIVATE", offerId: "OFFER-1", expectedRevision: 3 }, repository, { now: NOW });
    expect(await errorCode(() => mutateOffer(actor(), { action: "UPDATE_DRAFT", offerId: "OFFER-1", expectedRevision: 4, definition: draft() }, repository))).toBe("OFFER_INVALID_TRANSITION");
    await mutateOffer(approver, { action: "CANCEL", offerId: "OFFER-1", expectedRevision: 4, reason: "End" }, repository, { now: NOW });
    expect(await errorCode(() => mutateOffer(approver, { action: "PAUSE", offerId: "OFFER-1", expectedRevision: 5 }, repository))).toBe("OFFER_INVALID_TRANSITION");
  });
  it("allows an approved Scheduled Offer to be cancelled before start", async () => {
    const { repository } = await create(); const approver = actor("Admin", { uid: "ACTOR-2" });
    await mutateOffer(actor(), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 1 }, repository, { now: NOW });
    await mutateOffer(approver, { action: "APPROVE", offerId: "OFFER-1", expectedRevision: 2 }, repository, { now: "2026-08-01T00:00:00.000Z" });
    const cancelled = await mutateOffer(approver, { action: "CANCEL", offerId: "OFFER-1", expectedRevision: 3, reason: "Cancelled before launch" }, repository, { now: "2026-08-02T00:00:00.000Z" });
    expect(cancelled.lifecycleStatus).toBe("CANCELLED");
  });
});

describe("Offer Phase 2 legacy and read safety", () => {
  it("lists malformed legacy data defensively without coercing its type", async () => { const repository = new MemoryRepository(); repository.documents.set("LEGACY-1", { name: 12, type: "FIXED_DISCOUNT", createdBy: "ACTOR-1", createdAt: NOW }); const records = await listOffers(actor(), repository); expect(records[0]).toMatchObject({ kind: "LEGACY", offer: { id: "LEGACY-1", legacyTypeLabel: "FIXED_DISCOUNT", status: "READ_ONLY_LEGACY" } }); });
  it("supports legacy detail and denies every mutation", async () => { const repository = new MemoryRepository(); repository.documents.set("LEGACY-1", { name: "Old", type: "UNKNOWN_OLD", createdBy: "ACTOR-1", createdAt: NOW }); expect((await readOffer(actor(), "LEGACY-1", repository)).kind).toBe("LEGACY"); expect(await errorCode(() => mutateOffer(actor(), { action: "SUBMIT", offerId: "LEGACY-1", expectedRevision: 1 }, repository))).toBe("OFFER_LEGACY_READ_ONLY"); });
  it("fails unknown schema versions closed", async () => { const repository = new MemoryRepository(); repository.documents.set("FUTURE", { schemaVersion: 99, revision: 1, createdBy: "ACTOR-1", createdAt: NOW }); expect(await errorCode(() => mutateOffer(actor(), { action: "SUBMIT", offerId: "FUTURE", expectedRevision: 1 }, repository))).toBe("OFFER_UNSUPPORTED_SCHEMA"); });
  it("classifies canonical Offers without complete maker history as legacy read-only", async () => { const { repository, offer } = await create(); const historical = structuredClone(offer) as any; delete historical.makerIds; delete historical.makerAudit; repository.documents.set("OFFER-1", historical); expect((await readOffer(actor(), "OFFER-1", repository)).kind).toBe("LEGACY"); expect(await errorCode(() => mutateOffer(actor(), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 1 }, repository))).toBe("OFFER_MAKER_HISTORY_REQUIRED"); });
});


describe("simplified Offer authority and audience", () => {
  it("requires view plus canonical creator or ancestry, without a global/visibility bypass", async () => {
    const { repository } = await create();
    for (const uid of ["ACTOR-1", "ACTOR-2", "ACTOR-3"]) {
      expect((await listOffers(actor("Admin", { uid }), repository))).toHaveLength(1);
      expect((await readOffer(actor("Admin", { uid }), "OFFER-1", repository)).kind).toBe("CANONICAL");
    }
    const unrelated = actor("Super Admin", { uid: "OTHER" });
    expect(await listOffers(unrelated, repository)).toEqual([]);
    expect(await errorCode(() => readOffer(unrelated, "OFFER-1", repository))).toBe("OFFER_SCOPE_DENIED");
    const denied = actor("Admin", { permissions: { offerCapabilities: { "offers.view": false } } as any });
    expect(await errorCode(() => readOffer(denied, "OFFER-1", repository))).toBe("OFFER_PERMISSION_DENIED");
    expect(await errorCode(() => listOffers(denied, repository))).toBe("OFFER_PERMISSION_DENIED");
    const invalidHierarchy = { ...hierarchy, getUser: async () => null };
    expect(await listOffersService(actor(), repository, invalidHierarchy)).toEqual({ offers: [] });
    await expect(readOfferService(actor(), "OFFER-1", repository, { ...hierarchy, getUser: async () => ({ id: "FORGED", role: Role.ADMIN }) })).rejects.toMatchObject({ code: "OFFER_SCOPE_DENIED" });
  });

  it("requires approval capability and ancestry to creator, retaining pending status and no writes on rejection", async () => {
    const { repository } = await create();
    await mutateOffer(actor(), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 1 }, repository, { now: NOW });
    const before = structuredClone(repository.documents.get("OFFER-1"));
    for (const [user, code] of [[actor("Sales Manager", { uid: "ACTOR-2" }), "OFFER_PERMISSION_DENIED"], [actor("Super Admin", { uid: "OTHER" }), "OFFER_APPROVAL_ANCESTRY_REQUIRED"], [actor(), "OFFER_MAKER_APPROVER_CONFLICT"]] as const) {
      expect(await errorCode(() => mutateOffer(user, { action: "APPROVE", offerId: "OFFER-1", expectedRevision: 2 }, repository))).toBe(code);
      expect(repository.documents.get("OFFER-1")).toEqual(before);
    }
    const approved = await mutateOffer(actor("Admin", { uid: "ACTOR-2" }), { action: "APPROVE", offerId: "OFFER-1", expectedRevision: 2 }, repository, { now: NOW });
    expect(approved).toMatchObject({ createdBy: "ACTOR-1", approvedBy: "ACTOR-2", lifecycleStatus: "ACTIVE" });
  });

  it.each(["ALL_SALES_REPRESENTATIVES", "MY_SALES_TEAM", "SELECTED_SALES_REPRESENTATIVES"] as const)("preserves %s through create/edit/submit/read/list", async audienceType => {
    const eligibility = { ...draft().eligibility, audienceType, ...(audienceType === "SELECTED_SALES_REPRESENTATIVES" ? { audienceUserIds: ["REP-1"] } : {}) } as CanonicalOfferDefinition["eligibility"];
    const { repository } = await create(new MemoryRepository(), draft({ eligibility }));
    const updated = await mutateOffer(actor("Admin", { uid: "ACTOR-2" }), { action: "UPDATE_DRAFT", offerId: "OFFER-1", expectedRevision: 1, definition: draft({ eligibility }) }, repository, { now: NOW });
    expect(updated.createdBy).toBe("ACTOR-1");
    const submitted = await mutateOffer(actor("Admin", { uid: "ACTOR-2" }), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 2 }, repository, { now: NOW });
    expect(submitted.eligibility).toEqual(eligibility);
    expect((await readOffer(actor(), "OFFER-1", repository)).offer).toHaveProperty("eligibility", eligibility);
    expect((await listOffers(actor(), repository))[0].offer).toHaveProperty("eligibility", eligibility);
    expect(submitted).not.toHaveProperty("commercialContext");
    expect(submitted).not.toHaveProperty("price");
  });

  it.each([null, { id: "FORGED" }, { active: false }, { loginAllowed: false }, { status: "Suspended" }, { employmentStatus: "Inactive" }, { accountStatus: "INACTIVE" }, { isDeleted: true }, { role: Role.SALES_MANAGER }, { managerId: "OTHER" }, { active: "true" }])("rejects missing/forged/ineligible/non-descendant selected identity %j", async change => {
    const input = draft({ eligibility: { ...draft().eligibility, audienceType: "SELECTED_SALES_REPRESENTATIVES", audienceUserIds: ["REP-1"] } });
    const repository = new MemoryRepository();
    const injected = { ...hierarchy, getUser: async (uid: string) => uid === "REP-1" ? change === null ? null : { ...users.get(uid)!, ...change } as OrganizationalUser : hierarchy.getUser(uid) };
    await expect(createOfferDraftService(actor(), input, repository, injected, { now: NOW })).rejects.toMatchObject({ code: "OFFER_AUDIENCE_INVALID" });
    expect(repository.documents.size).toBe(0);
  });

  it("revalidates exact selected identities on submission even after successful draft validation", async () => {
    const input = draft({ eligibility: { ...draft().eligibility, audienceType: "SELECTED_SALES_REPRESENTATIVES", audienceUserIds: ["REP-1"] } });
    const { repository } = await create(new MemoryRepository(), input);
    const before = structuredClone(repository.documents.get("OFFER-1"));
    const getUser = vi.fn(async (uid: string) => uid === "REP-1" ? { ...users.get(uid)!, loginAllowed: false } : hierarchy.getUser(uid));
    await expect(mutateOfferService(actor(), { action: "SUBMIT", offerId: "OFFER-1", expectedRevision: 1 }, repository, { ...hierarchy, getUser }, { now: NOW })).rejects.toMatchObject({ code: "OFFER_AUDIENCE_INVALID" });
    expect(getUser).toHaveBeenCalledWith("REP-1");
    expect(repository.documents.get("OFFER-1")).toEqual(before);
  });

  it.each([{}, { audienceType: "UNKNOWN" }, { audienceType: "ALL_SALES_REPRESENTATIVES", audienceUserIds: [] }, { audienceType: "MY_SALES_TEAM", audienceUserIds: ["REP-1"] }, { audienceType: "SELECTED_SALES_REPRESENTATIVES", audienceUserIds: [] }, { audienceType: "SELECTED_SALES_REPRESENTATIVES", audienceUserIds: ["REP-1", "REP-1"] }])("rejects malformed audience without defaults %j", async audience => {
    const { startAt, endAt } = draft().eligibility;
    await expect(createOfferDraft(actor(), draft({ eligibility: { startAt, endAt, ...audience } as any }), new MemoryRepository())).rejects.toMatchObject({ code: "OFFER_INVALID_DEFINITION" });
  });

  it("resolves Offer identity/capability without operational or commercial reads", async () => {
    const get = vi.fn(async () => ({ exists: true, data: () => ({ offerCapabilities: { "offers.create": false } }) }));
    const doc = vi.fn(() => ({ get })); const collection = vi.fn(() => ({ doc }));
    const result = await resolveOfferAdministrationActor("ACTOR-1", { role: Role.ADMIN, active: true }, { collection } as any);
    expect(result).not.toHaveProperty("scope");
    expect(collection.mock.calls).toEqual([["rolePermissions"]]);
    expect(doc).toHaveBeenCalledWith(Role.ADMIN);
  });
});

describe("Offer bounded examined-batch pagination", () => {
  it("uses 25 by default, 50 at maximum, and rejects invalid requests before any repository query", async () => {
    const repository = new MemoryRepository(); const list = vi.spyOn(repository, "list");
    await listOffersService(actor(), repository, hierarchy);
    expect(list).toHaveBeenLastCalledWith({ pageSize: 25 });
    await listOffersService(actor(), repository, hierarchy, { pageSize: 50 });
    expect(list).toHaveBeenLastCalledWith({ pageSize: 50 });
    list.mockClear();
    for (const pageSize of [51, 0, -1, 1.5, "bad", " 25", null]) await expect(listOffersService(actor(), repository, hierarchy, { pageSize })).rejects.toMatchObject({ code: "OFFER_INVALID_REQUEST" });
    expect(list).not.toHaveBeenCalled();
  });

  it("advances after last examined even on an empty visible page, with deterministic ties and no draining", async () => {
    const repository = new MemoryRepository();
    for (const [id, creator] of [["OFFER-D", "OTHER"], ["OFFER-C", "OTHER"], ["OFFER-B", "ACTOR-1"], ["OFFER-A", "ACTOR-1"]]) await createOfferDraft(actor("Admin", { uid: creator }), draft(), repository, { id, now: NOW });
    const first = await listOffersService(actor(), repository, hierarchy, { pageSize: 2 });
    expect(first.offers).toEqual([]); expect(first.continuation).toBeTruthy();
    expect(repository.listCalls).toBe(1);
    expect(JSON.parse(Buffer.from(first.continuation!, "base64url").toString())).toEqual({ createdAt: NOW, documentId: "OFFER-C" });
    const second = await listOffersService(actor(), repository, hierarchy, { pageSize: 2, continuation: first.continuation });
    expect(second.offers.map(record => record.offer.id)).toEqual(["OFFER-B", "OFFER-A"]);
    expect(repository.listCalls).toBe(2);
    const end = await listOffersService(actor(), repository, hierarchy, { pageSize: 2, continuation: second.continuation });
    expect(end).toEqual({ offers: [] });
  });

  it("never treats a forged ordering tuple as record authorization", async () => {
    const repository = new MemoryRepository();
    await createOfferDraft(actor("Admin", { uid: "OTHER" }), draft(), repository, { id: "OFFER-A", now: NOW });
    const continuation = Buffer.from(JSON.stringify({ createdAt: NOW, documentId: "OFFER-Z" })).toString("base64url");
    expect((await listOffersService(actor(), repository, hierarchy, { continuation })).offers).toEqual([]);
  });

  it("constructs a bounded Firestore query in the approved order and tie-breaker", async () => {
    const calls: unknown[][] = [];
    const query = { orderBy: (...args: unknown[]) => { calls.push(["orderBy", ...args]); return query; }, startAfter: (...args: unknown[]) => { calls.push(["startAfter", ...args]); return query; }, limit: (limit: number) => { calls.push(["limit", limit]); return query; }, get: async () => { calls.push(["get"]); return { docs: [] }; } };
    const collection = vi.fn(() => query);
    const repository = createFirestoreOfferRepository({ collection } as any);
    await repository.list({ pageSize: 25, cursor: { createdAt: NOW, documentId: "OFFER-Z" } });
    expect(collection).toHaveBeenCalledWith("offers");
    expect(calls).toEqual([["orderBy", "createdAt", "desc"], ["orderBy", FieldPath.documentId(), "desc"], ["startAfter", NOW, "OFFER-Z"], ["limit", 25], ["get"]]);
  });
});

describe("independent bounded Offer options", () => {
  it("projects canonical Product identity/name/price via bounded readProducts only", async () => {
    const readProducts = vi.fn(async () => ({ records: [{ productId: "PRODUCT-1", name: "Synthetic One", price: 11, unitPrice: 999 }, { productId: "PRODUCT-2", name: "Synthetic Two", price: 22 }], nextCursor: "PRODUCT-2" }));
    expect(await readOfferProductOptions(actor(), { readProducts }, "PRODUCT-0")).toEqual({ marketContext: { status: "UNRESOLVED" }, products: [{ id: "PRODUCT-1", name: "Synthetic One", price: 11 }, { id: "PRODUCT-2", name: "Synthetic Two", price: 22 }], continuation: "PRODUCT-2" });
    expect(readProducts).toHaveBeenCalledExactlyOnceWith({ limit: 100, cursor: "PRODUCT-0" });
  });
  it.each([undefined, null, "11", NaN, Infinity, -1])("rejects malformed Product.price %s without fallback", async price => {
    await expect(readOfferProductOptions(actor(), { readProducts: async () => ({ records: [{ productId: "PRODUCT-1", name: "Synthetic", price, unitPrice: 12 }] }) })).rejects.toMatchObject({ code: "OFFER_PRODUCT_DISPLAY_INVALID" });
  });
  it("derives picker root from actor for new drafts and persisted creator for existing drafts", async () => {
    const { repository } = await create();
    const getDirectReportsPage = vi.fn(hierarchy.getDirectReportsPage);
    const injected = { ...hierarchy, getDirectReportsPage };
    expect((await readOfferRepresentativeOptions(actor(), {}, repository, injected)).representatives.map(user => user.id)).toEqual(["REP-1"]);
    expect(getDirectReportsPage.mock.calls[0][0]).toBe("ACTOR-1");
    getDirectReportsPage.mockClear();
    expect((await readOfferRepresentativeOptions(actor("Admin", { uid: "ACTOR-2" }), { offerId: "OFFER-1" }, repository, injected)).representatives.map(user => user.id)).toEqual(["REP-1"]);
    expect(getDirectReportsPage.mock.calls[0][0]).toBe("ACTOR-1");
    getDirectReportsPage.mockClear();
    await expect(readOfferRepresentativeOptions(actor("Super Admin", { uid: "OTHER" }), { offerId: "OFFER-1" }, repository, injected)).rejects.toMatchObject({ code: "OFFER_SCOPE_DENIED" });
    expect(getDirectReportsPage).not.toHaveBeenCalled();
  });
  it("passes opaque picker continuation to the existing hierarchy contract", async () => {
    const getContinuation = vi.fn(async () => null);
    await expect(readOfferRepresentativeOptions(actor(), { continuationToken: "TOKEN-A", pageSize: 100 }, new MemoryRepository(), { ...hierarchy, getContinuation })).rejects.toMatchObject({ code: "HIERARCHY_CONTINUATION_INVALID" });
    expect(getContinuation).toHaveBeenCalledWith("TOKEN-A");
  });
});


describe("Offer integration dependency boundaries", () => {
  it("retains Product configuration operational and commercial scope independently", async () => {
    const operational = { authorized: true, subjectMode: "SELF", countryIds: ["COUNTRY-A", "COUNTRY-B"], areaIds: ["AREA-A"], productIds: ["PRODUCT-A", "PRODUCT-B"] };
    vi.mocked(resolveOperationalScopeForActor).mockResolvedValueOnce(operational as any);
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) };
    const result = await resolveProductConfigurationActor("ACTOR-1", { role: Role.ADMIN, companyIds: ["COMPANY-A", "COMPANY-B"], marketIds: ["MARKET-A", "MARKET-B"] }, db as any);
    expect(result.scope).toEqual({ global: false, companyIds: ["COMPANY-A", "COMPANY-B"], marketIds: ["MARKET-A", "MARKET-B"], countryIds: operational.countryIds, areaIds: operational.areaIds, productIds: operational.productIds });
    expect(resolveOperationalScopeForActor).toHaveBeenCalledWith("ACTOR-1", {}, {});
    vi.mocked(resolveOperationalScopeForActor).mockClear();
    await resolveOfferAdministrationActor("ACTOR-1", { role: Role.ADMIN }, db as any);
    expect(resolveOperationalScopeForActor).not.toHaveBeenCalled();
  });

  it("does not expose an inaccessible Offer through a mutation response", async () => {
    const { repository } = await create();
    const before = structuredClone(repository.documents.get("OFFER-1"));
    for (const user of [actor("Super Admin", { uid: "OTHER" }), actor("Admin", { permissions: { offerCapabilities: { "offers.view": false } } as any })]) {
      await expect(mutateOffer(user, { action: "UPDATE_DRAFT", offerId: "OFFER-1", expectedRevision: 1, definition: draft() }, repository)).rejects.toBeInstanceOf(OfferAdministrationError);
      expect(repository.documents.get("OFFER-1")).toEqual(before);
    }
  });

  it("reuses live bounded hierarchy continuation across picker pages", async () => {
    const records = new Map(users);
    records.set("REP-2", { id: "REP-2", role: Role.SALES_REP, managerId: "ACTOR-1", active: true });
    const states = new Map<string, HierarchyContinuationSnapshot>();
    const injected: ReportingDescendantRepository = {
      getUser: async uid => records.get(uid) || null,
      getDirectReportsPage: vi.fn(async (manager, after, limit) => [...records.values()].filter(user => user.managerId === manager && (!after || user.id > after)).sort((a,b) => a.id.localeCompare(b.id)).slice(0,limit)),
      getContinuation: async token => states.get(token) || null,
      advanceContinuation: async (current, replacement) => {
        if (current) states.delete(current.token);
        if (replacement) states.set(replacement.token, { ...replacement, revision: 1 });
      },
    };
    const repository = new MemoryRepository();
    const first = await readOfferRepresentativeOptions(actor(), { pageSize: 1 }, repository, injected);
    expect(first.representatives.map(user => user.id)).toEqual(["REP-1"]);
    expect(first.continuationToken).toBeTruthy();
    expect(states.get(first.continuationToken!)?.document).toMatchObject({ actorUid: "ACTOR-1", rootUid: "ACTOR-1", pageSize: 1 });
    const second = await readOfferRepresentativeOptions(actor(), { pageSize: 1, continuationToken: first.continuationToken }, repository, injected);
    expect(second.representatives.map(user => user.id)).toEqual(["REP-2"]);
    expect(states.has(first.continuationToken!)).toBe(false);
    const done = await readOfferRepresentativeOptions(actor(), { pageSize: 1, continuationToken: second.continuationToken }, repository, injected);
    expect(done).toEqual({ representatives: [] });
    expect(states.size).toBe(0);
  });
});

describe("original creator Product authority", () => {
  it("rejects genuine Sales Manager creator self approval with capability denial and zero mutation", async () => {
    const creator = actor("Sales Manager");
    const { repository, offer } = await create(new MemoryRepository(), draft(), creator);
    expect(offer.createdBy).toBe(creator.uid);
    expect(users.get(creator.uid)?.role).toBe(creator.role);
    await mutateOffer(creator, { action: "SUBMIT", offerId: offer.id, expectedRevision: 1 }, repository, { now: NOW });
    const before = structuredClone(repository.documents.get(offer.id));
    const result = await errorCode(() => mutateOffer(creator, { action: "APPROVE", offerId: offer.id, expectedRevision: 2 }, repository, { now: NOW }));
    expect(repository.documents.get(offer.id)).toEqual(before);
    expect(result).toBe("OFFER_PERMISSION_DENIED");
    expect(repository.documents.get(offer.id)?.createdBy).toBe(creator.uid);
  });
  const scoped = (ids: string[]) => ({ ...defaultOfferScopeDependencies, resolveScope: vi.fn(async (uid: string) => ({ authorized: true, actorUid: uid, productIds: ids, productGroupIds: [], queryPlan: { denyAll: false } } as any)) });
  it("keeps creator scope for candidates and edits regardless of updatedBy or maker audit", async () => {
    const repository = new MemoryRepository();
    const creator = actor("Sales Manager"), editor = actor("Admin", { uid: "ACTOR-2" });
    const deps = scoped(["PRODUCT-1"]);
    const definition = draft({ productScope: { mode: "SELECTED_PRODUCTS", productIds: ["PRODUCT-1"] } });
    const saved = await createOfferDraftService(creator, definition, repository, hierarchy, { id: "SCOPED", scopeDependencies: deps });
    const edited = await mutateOfferService(editor, { action: "UPDATE_DRAFT", offerId: saved.id, expectedRevision: 1, definition }, repository, hierarchy, { scopeDependencies: deps });
    expect(edited.createdBy).toBe(creator.uid);
    expect(edited.updatedBy).toBe(editor.uid);
    expect(edited.makerIds).toContain(editor.uid);
    const page = await readOfferProductOptions(editor, { readProducts: async () => ({ records: [...repository.products.values()] }) }, undefined, { offerId: saved.id, repository, hierarchy, dependencies: deps });
    expect(page.products.map(p => p.id)).toEqual(["PRODUCT-1"]);
    expect(deps.resolveScope.mock.calls.map(([uid]) => uid)).toEqual([creator.uid, creator.uid, creator.uid, editor.uid]);
    const before = structuredClone(repository.documents.get(saved.id));
    await expect(mutateOfferService(editor, { action: "UPDATE_DRAFT", offerId: saved.id, expectedRevision: 2, definition: draft({ productScope: { mode: "SELECTED_PRODUCTS", productIds: ["PRODUCT-2"] } }) }, repository, hierarchy, { scopeDependencies: deps })).rejects.toMatchObject({ code: "OFFER_SCOPE_DENIED" });
    expect(repository.documents.get(saved.id)).toEqual(before);
  });
  it.each(["trigger", "reward"])("rejects an out-of-scope %s without creating an Offer", async kind => {
    const repository = new MemoryRepository(), deps = scoped(["PRODUCT-1"]);
    const input = kind === "trigger" ? draft({ productScope: { mode: "SELECTED_PRODUCTS", productIds: ["PRODUCT-2"] } }) : draft({ type: "BUY_X_GET_Y", benefit: { kind: "BUY_X_GET_Y", buyQuantity: 2, freeQuantity: 1, reward: { mode: "SELECTED_PRODUCT", rewardProductId: "PRODUCT-2" }, aggregationMode: "PER_PRODUCT", multiples: "REPEAT_COMPLETE_MULTIPLES", remainder: "NO_REWARD_BELOW_THRESHOLD" } });
    await expect(createOfferDraftService(actor(), input, repository, hierarchy, { scopeDependencies: deps })).rejects.toMatchObject({ code: "OFFER_SCOPE_DENIED" });
    expect(repository.documents.size).toBe(0);
  });
  it("revalidates creator assignment loss on lifecycle transition without mutation", async () => {
    const repository = new MemoryRepository(), deps = scoped(["PRODUCT-1"]);
    const saved = await createOfferDraftService(actor(), draft({ productScope: { mode: "SELECTED_PRODUCTS", productIds: ["PRODUCT-1"] } }), repository, hierarchy, { id: "LOSS", scopeDependencies: deps });
    const before = structuredClone(repository.documents.get(saved.id));
    deps.resolveScope.mockImplementation(async uid => ({ authorized: true, actorUid: uid, productIds: ["PRODUCT-2"], productGroupIds: [], queryPlan: { denyAll: false } } as any));
    await expect(mutateOfferService(actor(), { action: "SUBMIT", offerId: saved.id, expectedRevision: 1 }, repository, hierarchy, { scopeDependencies: deps })).rejects.toMatchObject({ code: "OFFER_SCOPE_DENIED" });
    expect(repository.documents.get(saved.id)).toEqual(before);
  });
});

describe("Sales Manager approval rule certification", () => {
  async function pending() {
    const creator = actor("Sales Manager");
    const approver = actor("Super Admin", { uid: "ACTOR-3" });
    const repository = new MemoryRepository();
    const scopeDependencies = {
      ...defaultOfferScopeDependencies,
      resolveScope: vi.fn(async (uid: string) => ({
        authorized: true, actorUid: uid,
        productIds: uid === creator.uid ? ["PRODUCT-1"] : ["PRODUCT-1", "PRODUCT-2"],
        productGroupIds: [], queryPlan: { denyAll: false },
      } as any)),
    };
    expect(users.get(creator.uid)?.role).toBe(creator.role);
    expect(users.get(creator.uid)?.managerId).toBe("ACTOR-2");
    expect(users.get("ACTOR-2")?.managerId).toBe(approver.uid);
    expect(users.get(approver.uid)?.role).toBe(approver.role);
    expect(resolveOfferCapabilities(creator.role)["offers.create"]).toBe(true);
    expect(resolveOfferCapabilities(approver.role)["offers.approve"]).toBe(true);
    const saved = await createOfferDraftService(creator, draft({
      productScope: { mode: "SELECTED_PRODUCTS", productIds: ["PRODUCT-1"] },
    }), repository, hierarchy, { id: "CERTIFICATION-OFFER", now: NOW, scopeDependencies });
    expect(saved).toMatchObject({ createdBy: creator.uid, lifecycleStatus: "DRAFT", revision: 1 });
    const submitted = await mutateOfferService(creator, {
      action: "SUBMIT", offerId: saved.id, expectedRevision: 1,
    }, repository, hierarchy, { now: NOW, scopeDependencies });
    expect(submitted).toMatchObject({ createdBy: creator.uid, lifecycleStatus: "PENDING_APPROVAL", revision: 2 });
    scopeDependencies.resolveScope.mockClear();
    return { creator, approver, repository, scopeDependencies, submitted };
  }

  it("approves a genuine Sales Manager Offer through an indirect authorized ancestor without transferring Product authority", async () => {
    const { creator, approver, repository, scopeDependencies, submitted } = await pending();
    const approved = await mutateOfferService(approver, {
      action: "APPROVE", offerId: submitted.id, expectedRevision: 2,
    }, repository, hierarchy, { now: NOW, scopeDependencies });
    expect(approved).toMatchObject({
      createdBy: creator.uid, approvedBy: approver.uid, approvedAt: NOW,
      lifecycleStatus: "ACTIVE", revision: 3,
      productScope: { mode: "SELECTED_PRODUCTS", productIds: ["PRODUCT-1"] },
    });
    expect(scopeDependencies.resolveScope).toHaveBeenCalledWith(creator.uid);
    expect(scopeDependencies.resolveScope.mock.calls.every(([uid]) => uid === creator.uid)).toBe(true);
  });

  it("rejects an unrelated approval-capable manager with zero mutation", async () => {
    const { repository, scopeDependencies, submitted } = await pending();
    const unrelated = actor("Super Admin", { uid: "OTHER" });
    expect(users.get(unrelated.uid)?.role).toBe(unrelated.role);
    expect(resolveOfferCapabilities(unrelated.role)["offers.approve"]).toBe(true);
    const before = structuredClone([...repository.documents]);
    await expect(mutateOfferService(unrelated, {
      action: "APPROVE", offerId: submitted.id, expectedRevision: 2,
    }, repository, hierarchy, { now: NOW, scopeDependencies })).rejects.toMatchObject({ code: "OFFER_APPROVAL_ANCESTRY_REQUIRED" });
    expect([...repository.documents]).toEqual(before);
  });

  it("cannot rescue an out-of-creator-scope pending Product using the ancestor approver scope", async () => {
    const { creator, approver, repository, scopeDependencies, submitted } = await pending();
    // Synthetic persisted reference: independently revalidate it at approval.
    repository.documents.set(submitted.id, {
      ...structuredClone(submitted),
      productScope: { mode: "SELECTED_PRODUCTS", productIds: ["PRODUCT-2"] },
    });
    const before = structuredClone([...repository.documents]);
    await expect(mutateOfferService(approver, {
      action: "APPROVE", offerId: submitted.id, expectedRevision: 2,
    }, repository, hierarchy, { now: NOW, scopeDependencies })).rejects.toMatchObject({ code: "OFFER_SCOPE_DENIED" });
    expect([...repository.documents]).toEqual(before);
    expect(repository.documents.get(submitted.id)?.createdBy).toBe(creator.uid);
    expect(scopeDependencies.resolveScope).toHaveBeenCalledWith(creator.uid);
    expect(scopeDependencies.resolveScope.mock.calls.every(([uid]) => uid === creator.uid)).toBe(true);
  });
});

describe("Offer display geography remains separate from Product authority", () => {
  const scope = (uid: string, countryIds: string[], productIds = ["PRODUCT-1"]) => ({ authorized: true, actorUid: uid, countryIds, productIds, productGroupIds: [], queryPlan: { denyAll: false } } as any);
  it("reuses a new creator scope once and reads its effective country only", async () => {
    const creator = actor("Sales Manager");
    const dependencies = { resolveScope: vi.fn(async uid => scope(uid, ["CURRENT-COUNTRY"])), readMarket: vi.fn(async () => ({ status: "UNRESOLVED" as const })) };
    await readOfferProductOptions(creator, { readProducts: async () => ({ records: [] }) }, undefined, { dependencies });
    expect(dependencies.resolveScope).toHaveBeenCalledExactlyOnceWith(creator.uid);
    expect(dependencies.readMarket).toHaveBeenCalledExactlyOnceWith("CURRENT-COUNTRY");
  });
  it("uses editor geography for currency while only creator Products remain selectable", async () => {
    const creator = actor("Sales Manager"), editor = actor("Admin", { uid: "ACTOR-2" });
    const repository = new MemoryRepository();
    const dependencies = {
      resolveScope: vi.fn(async uid => scope(uid, [uid === creator.uid ? "CREATOR-COUNTRY" : "EDITOR-COUNTRY"], uid === creator.uid ? ["PRODUCT-1"] : ["PRODUCT-1", "PRODUCT-2"])),
      readMarket: vi.fn(async () => ({ status: "RESOLVED" as const, market: { currencyCode: "TST" } as any })),
    };
    const saved = await createOfferDraftService(creator, draft(), repository, hierarchy, { id: "DISPLAY", scopeDependencies: dependencies });
    dependencies.resolveScope.mockClear();
    const before = structuredClone([...repository.documents]);
    const result = await readOfferProductOptions(editor, { readProducts: async () => ({ records: [...repository.products.values()] }) }, undefined, { offerId: saved.id, repository, hierarchy, dependencies });
    expect(result.products.map(p => p.id)).toEqual(["PRODUCT-1"]);
    expect(result.marketContext).toMatchObject({ status: "RESOLVED", market: { currencyCode: "TST" } });
    expect(dependencies.resolveScope.mock.calls.map(([uid]) => uid)).toEqual([creator.uid, editor.uid]);
    expect(dependencies.readMarket).toHaveBeenCalledExactlyOnceWith("EDITOR-COUNTRY");
    expect([...repository.documents]).toEqual(before);
  });
  it.each([{ countryIds: [] }, { countryIds: ["C1", "C2"] }, { authorized: false }, { actorUid: "FORGED" }, { queryPlan: { denyAll: true } }])("does not use profile fields when editor scope is unresolved: %j", async patch => {
    const creator = actor("Sales Manager"), editor = actor("Admin", { uid: "ACTOR-2" });
    const repository = new MemoryRepository();
    const dependencies = { resolveScope: vi.fn(async uid => ({ ...scope(uid, ["COUNTRY"]), ...(uid === editor.uid ? patch : {}) })), readMarket: vi.fn() };
    const saved = await createOfferDraftService(creator, draft(), repository, hierarchy, { id: "UNRESOLVED-DISPLAY", scopeDependencies: dependencies });
    const result = await readOfferProductOptions({ ...editor, country: "Free text", marketId: "PROFILE", countryId: "PROFILE" } as any, { readProducts: async () => ({ records: [] }) }, undefined, { offerId: saved.id, repository, hierarchy, dependencies });
    expect(result.marketContext).toEqual({ status: "UNRESOLVED" });
    expect(dependencies.readMarket).not.toHaveBeenCalled();
  });
});

describe("new ancestor approvers retain scoped administration gates", () => {
  it.each([Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER, Role.ADMIN, Role.SUPER_ADMIN])("%s sees and approves only descendant-created Offers", async role => {
    const creator = actor("Sales Manager");
    const approver = actor(role, { uid: "ACTOR-2" });
    const unrelated = actor(role, { uid: "UNRELATED-ANCESTOR" });
    const records = new Map(users);
    records.set(approver.uid, { id: approver.uid, role, managerId: "TOP-ADMIN", active: true });
    records.set(unrelated.uid, { id: unrelated.uid, role, managerId: "TOP-ADMIN", active: true });
    records.set("TOP-ADMIN", { id: "TOP-ADMIN", role: Role.ADMIN, managerId: "ACTOR-3", active: true });
    const localHierarchy = { ...hierarchy, getUser: async (uid: string) => records.get(uid) || null };
    const repository = new MemoryRepository();
    const saved = await createOfferDraftService(creator, draft(), repository, localHierarchy, { id: "ANCESTOR-OFFER", now: NOW });
    await mutateOfferService(creator, { action: "SUBMIT", offerId: saved.id, expectedRevision: 1 }, repository, localHierarchy, { now: NOW });
    expect((await listOffersService(approver, repository, localHierarchy)).offers).toHaveLength(1);
    expect((await listOffersService(unrelated, repository, localHierarchy)).offers).toEqual([]);
    await expect(readOfferService(unrelated, saved.id, repository, localHierarchy)).rejects.toMatchObject({ code: "OFFER_SCOPE_DENIED" });
    const before = structuredClone([...repository.documents]);
    await expect(mutateOfferService(unrelated, { action: "APPROVE", offerId: saved.id, expectedRevision: 2 }, repository, localHierarchy, { now: NOW })).rejects.toMatchObject({ code: "OFFER_APPROVAL_ANCESTRY_REQUIRED" });
    expect([...repository.documents]).toEqual(before);
    const approved = await mutateOfferService(approver, { action: "APPROVE", offerId: saved.id, expectedRevision: 2 }, repository, localHierarchy, { now: NOW });
    expect(approved).toMatchObject({ createdBy: creator.uid, approvedBy: approver.uid, revision: 3, lifecycleStatus: "ACTIVE" });
  });
});

describe("one-action approval compatibility and rejection safety", () => {
  async function pending() {
    const { repository, offer } = await create(new MemoryRepository(), draft(), actor("Sales Manager"));
    await mutateOffer(actor("Sales Manager"), { action: "SUBMIT", offerId: offer.id, expectedRevision: 1 }, repository, { now: NOW });
    return { repository, id: offer.id, approver: actor("Admin", { uid: "ACTOR-2" }) };
  }
  it("completes an explicitly approved old pending state without replacing prior approval or maker history", async () => {
    const { repository, id, approver } = await pending();
    const old = { ...repository.documents.get(id)!, approvedAt: "2026-09-02T12:00:00.000Z", approvedBy: "ACTOR-3", returnedBy: approver.uid, reviewedBy: approver.uid, editedBy: approver.uid };
    repository.documents.set(id, old);
    const result = await mutateOffer(approver, { action: "APPROVE", offerId: id, expectedRevision: 2 }, repository, { now: NOW });
    expect(result).toMatchObject({ lifecycleStatus: "ACTIVE", createdBy: "ACTOR-1", approvedAt: old.approvedAt, approvedBy: old.approvedBy, activatedBy: approver.uid, makerAudit: old.makerAudit, makerIds: old.makerIds, returnedBy: approver.uid, reviewedBy: approver.uid, editedBy: approver.uid });
  });
  it("uses approval authority without requiring separately granted activation", async () => {
    const { repository, id } = await pending();
    const approver = actor("Sales & Marketing Manager", { uid: "ACTOR-2", permissions: { offerCapabilities: { "offers.activate": false } } as any });
    expect(resolveOfferCapabilities(approver.role, approver.permissions)["offers.activate"]).toBe(false);
    expect((await mutateOffer(approver, { action: "APPROVE", offerId: id, expectedRevision: 2 }, repository, { now: NOW })).lifecycleStatus).toBe("ACTIVE");
  });
  it.each(["offers.view", "offers.approve"])("preserves persisted %s denial with no mutation", async capability => {
    const { repository, id, approver } = await pending();
    const before = structuredClone([...repository.documents]);
    await expect(mutateOffer({ ...approver, permissions: { offerCapabilities: { [capability]: false } } as any }, { action: "APPROVE", offerId: id, expectedRevision: 2 }, repository, { now: NOW })).rejects.toMatchObject({ code: "OFFER_PERMISSION_DENIED" });
    expect([...repository.documents]).toEqual(before);
  });
  it("rejects expired approval without storing approval or activation", async () => {
    const { repository, id, approver } = await pending();
    const before = structuredClone([...repository.documents]);
    await expect(mutateOffer(approver, { action: "APPROVE", offerId: id, expectedRevision: 2 }, repository, { now: "2026-10-01T00:00:00.000Z" })).rejects.toMatchObject({ code: "OFFER_NOT_CURRENTLY_VALID" });
    expect([...repository.documents]).toEqual(before);
  });
});
