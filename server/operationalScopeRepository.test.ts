import { readFileSync } from "node:fs";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { describe, expect, it, vi } from "vitest";

vi.mock("./firebaseAdmin", () => ({
  getFirebaseAdminServices: vi.fn(() => {
    throw new Error("Firebase must not be initialized by the adapter certification");
  }),
}));

import {
  resolveOperationalScopeForActor,
  type OperationalScopeRepository,
} from "./operationalScopeRepository";

describe("WP5.2E operational scope backend adapter certification", () => {
  it("Requirement 29 — Product Manager uses explicit canonical functional assignments", async () => {
    const actorUid = "product-manager-adapter-test";
    const actor = {
      id: actorUid,
      role: "Product Manager",
      active: true,
      loginAllowed: true,
      status: "Active",
      securityScope: "Area",
      areaIds: ["A1"],
      country: "C1",
    };

    const repository: OperationalScopeRepository = {
      hierarchy: {
        async getUser(uid) {
          return uid === actorUid ? actor : null;
        },
        async getDirectReports() {
          return [];
        },
        async getAllUsers() {
          return [actor];
        },
        async getRolePermissions() {
          return null;
        },
      },
      async getGeographyCatalog() {
        return {
          countries: [{ id: "C1", name: "Country 1", active: true }],
          districts: [{ id: "R1", countryId: "C1", active: true }],
          cities: [
            { id: "CT1", countryId: "C1", districtId: "R1", active: true },
            { id: "CT2", countryId: "C1", districtId: "R1", active: true },
          ],
          areas: [
            { id: "A1", countryId: "C1", districtId: "R1", cityId: "CT1", active: true },
            { id: "A2", countryId: "C1", districtId: "R1", cityId: "CT2", active: true },
          ],
          nodes: [
            { countryId: "C1", regionId: "R1", districtId: "R1", cityId: "CT1", areaId: "A1", active: true },
            { countryId: "C1", regionId: "R1", districtId: "R1", cityId: "CT2", areaId: "A2", active: true },
          ],
        };
      },
      async getTerritoryAssignments(subjectUids) {
        expect(subjectUids).toEqual([actorUid]);
        return [
          {
            assignmentId: "TA-A1",
            userId: actorUid,
            status: "Active",
            active: true,
            countryId: "C1",
            regionId: "R1",
            districtId: "R1",
            cityId: "CT1",
            areaId: "A1",
          },
          {
            assignmentId: "TA-A2",
            userId: actorUid,
            status: "Active",
            active: true,
            countryId: "C1",
            regionId: "R1",
            districtId: "R1",
            cityId: "CT2",
            areaId: "A2",
          },
        ];
      },
      async getProductAssignments(subjectUids) {
        expect(subjectUids).toEqual([actorUid]);
        return [{ id: "PA-P1", userId: actorUid, productId: "P1", productGroupId: "PG1", status: "Active", active: true }];
      },
      async getProducts() {
        return [{ id: "P1", promotionGroupId: "PG1", active: true } as any];
      },
    };

    const result = await resolveOperationalScopeForActor(
      actorUid,
      { actorUid },
      repository,
    );

    expect(result.authorized).toBe(true);
    expect(result.role).toBe("Product Manager");
    expect(result.boundaryKind).toBe("GLOBAL");
    expect(result.subjectMode).toBe("FUNCTIONAL");
    expect(result.areaIds).toEqual(["A1", "A2"]);
    expect(result.queryPlan.denyAll).toBe(false);
    expect(result.queryPlan.areaIdChunks).toEqual([["A1", "A2"]]);
    expect(result.productIds).toEqual(["P1"]);
    expect(result.diagnostics.outsideBoundaryAssignmentIds).toEqual([]);
  });

  it("fails Product Manager functional scope closed without an active canonical Product assignment", async () => {
    const actorUid = "functional-actor";
    const repository: OperationalScopeRepository = {
      hierarchy: {
        async getUser() { return { id: actorUid, role: "Product Manager", active: true, loginAllowed: true }; },
        async getDirectReports() { return []; },
        async getAllUsers() { return []; },
        async getRolePermissions() { return null; },
      },
      async getGeographyCatalog() { return { countries: [{ id: "C" }], districts: [{ id: "D", countryId: "C" }], cities: [{ id: "CT", countryId: "C", districtId: "D" }], areas: [{ id: "A", countryId: "C", districtId: "D", cityId: "CT" }], nodes: [{ countryId: "C", regionId: "D", districtId: "D", cityId: "CT", areaId: "A", active: true }] }; },
      async getTerritoryAssignments() { return [{ assignmentId: "TA", userId: actorUid, status: "Active", active: true, countryId: "C", regionId: "D", districtId: "D", cityId: "CT", areaId: "A" }]; },
      async getProductAssignments() { return []; },
      async getProducts() { return []; },
    };
    expect(await resolveOperationalScopeForActor(actorUid, {}, repository)).toMatchObject({ authorized: false, code: "NO_ACTIVE_PRODUCT_ASSIGNMENTS", areaIds: [] });
  });
});

describe("Fix 5B.3A descendant-only assignment inheritance", () => {
  type TestUser = {
    id: string;
    role: string;
    managerId?: string;
    active?: boolean;
    loginAllowed?: boolean;
    department?: string;
    city?: string;
  };

  const user = (id: string, role: string, managerId = "", extra: Partial<TestUser> = {}): TestUser => ({
    id,
    role,
    managerId,
    active: true,
    loginAllowed: true,
    ...extra,
  });

  const geography = [
    { countryId: "C1", regionId: "D1", districtId: "D1", cityId: "CT1", areaId: "A1", active: true },
    { countryId: "C1", regionId: "D1", districtId: "D1", cityId: "CT2", areaId: "A2", active: true },
    { countryId: "C1", regionId: "D1", districtId: "D1", cityId: "CT3", areaId: "A3", active: true },
    { countryId: "C1", regionId: "D1", districtId: "D1", cityId: "CT4", areaId: "AM", active: true },
  ];

  function scopeRepository({
    actor,
    users,
    territoryAssignments,
    productAssignments,
    governance,
    requested,
  }: {
    actor: TestUser;
    users: TestUser[];
    territoryAssignments: any[];
    productAssignments: any[];
    governance?: { active?: boolean; scopePolicy?: Record<string, unknown> } | null;
    requested?: { territory?: string[][]; product?: string[][] };
  }): OperationalScopeRepository {
    const allUsers = users.some((entry) => entry.id === actor.id) ? users : [actor, ...users];
    return {
      hierarchy: {
        async getUser(uid) { return allUsers.find((entry) => entry.id === uid) as any || null; },
        async getDirectReports(managerUid) { return allUsers.filter((entry) => entry.managerId === managerUid) as any; },
        async getAllUsers() { return allUsers as any; },
        async getRolePermissions() { return null; },
        async getAccessGovernance() { return governance || null; },
      },
      async getGeographyCatalog() {
        return {
          countries: [{ id: "C1", active: true }],
          districts: [{ id: "D1", countryId: "C1", active: true }],
          cities: geography.map((node) => ({ id: node.cityId, countryId: node.countryId, districtId: node.districtId, active: true })),
          areas: geography.map((node) => ({ id: node.areaId, countryId: node.countryId, districtId: node.districtId, cityId: node.cityId, active: true })),
          nodes: geography,
        };
      },
      async getTerritoryAssignments(subjectUids) {
        requested?.territory?.push([...subjectUids]);
        const subjects = new Set(subjectUids);
        return territoryAssignments.filter((assignment) => subjects.has(assignment.userId));
      },
      async getProductAssignments(subjectUids) {
        requested?.product?.push([...subjectUids]);
        const subjects = new Set(subjectUids);
        return productAssignments.filter((assignment) => subjects.has(assignment.userId));
      },
      async getProducts() {
        return ["P1", "P2", "P3", "PM"].map((id) => ({ id, active: true, status: "Active" } as any));
      },
    };
  }

  const territory = (assignmentId: string, userId: string, areaId: string, cityId: string) => ({
    assignmentId,
    userId,
    status: "Active",
    active: true,
    countryId: "C1",
    regionId: "D1",
    districtId: "D1",
    cityId,
    areaId,
  });
  const product = (id: string, userId: string, productId: string, productGroupId: string) => ({
    id,
    assignmentId: id,
    userId,
    productId,
    productGroupId,
    status: "Active",
    active: true,
  });

  it("inherits the deduplicated union of direct and recursive descendant geography and products, across cities", async () => {
    const manager = user("manager", "Medical Manager", "", { city: "CT4", department: "medical" });
    const supervisor = user("supervisor", "Medical Supervisor", manager.id, { department: "medical" });
    const directRep = user("direct-rep", "Medical Representative", manager.id, { department: "medical" });
    const nestedRep = user("nested-rep", "Medical Representative", supervisor.id, { department: "medical" });
    const requested = { territory: [] as string[][], product: [] as string[][] };
    const repository = scopeRepository({
      actor: manager,
      users: [manager, supervisor, directRep, nestedRep],
      territoryAssignments: [
        territory("TM", manager.id, "AM", "CT4"),
        territory("T1", directRep.id, "A1", "CT1"),
        territory("T2", nestedRep.id, "A2", "CT2"),
        territory("T2-DUP", nestedRep.id, "A2", "CT2"),
      ],
      productAssignments: [
        product("PM", manager.id, "PM", "PGM"),
        product("P1-A", directRep.id, "P1", "PG1"),
        product("P1-B", nestedRep.id, "P1", "PG1"),
        product("P2", nestedRep.id, "P2", "PG2"),
      ],
      requested,
    });

    const result = await resolveOperationalScopeForActor(manager.id, {}, repository);

    expect(requested.territory).toEqual([[directRep.id, nestedRep.id, supervisor.id]]);
    expect(requested.product).toEqual([[directRep.id, nestedRep.id, supervisor.id]]);
    expect(result.subjectUids).toEqual([directRep.id, manager.id, nestedRep.id, supervisor.id]);
    expect(result.areaIds).toEqual(["A1", "A2"]);
    expect(result.cityIds).toEqual(["CT1", "CT2"]);
    expect(result.productIds).toEqual(["P1", "P2"]);
    expect(result.productGroupIds).toEqual(["PG1", "PG2"]);
    expect(result.areaIds).not.toContain("AM");
    expect(result.productIds).not.toContain("PM");
    expect(result.productGroupIds).not.toContain("PGM");
  });

  it("preserves the Fix 5B.2 Medical Supervisor one-representative scope", async () => {
    const supervisor = user("medical-supervisor", "Medical Supervisor", "", { city: "CT4", department: "medical" });
    const representative = user("medical-representative", "Medical Representative", supervisor.id, { city: "CT1", department: "medical" });
    const result = await resolveOperationalScopeForActor(supervisor.id, {}, scopeRepository({
      actor: supervisor,
      users: [supervisor, representative],
      territoryAssignments: [
        territory("TS", supervisor.id, "AM", "CT4"),
        territory("TR", representative.id, "A1", "CT1"),
      ],
      productAssignments: [
        product("PS", supervisor.id, "PM", "PGM"),
        product("PR", representative.id, "P1", "PG1"),
      ],
    }));
    expect(result.subjectUids).toEqual([representative.id, supervisor.id]);
    expect(result.areaIds).toEqual(["A1"]);
    expect(result.productIds).toEqual(["P1"]);
    expect(result.productGroupIds).toEqual(["PG1"]);
  });

  it("excludes inactive descendant branches and preserves medical department isolation", async () => {
    const manager = user("medical-manager", "Medical Manager", "", { department: "medical" });
    const activeRep = user("medical-rep", "Medical Representative", manager.id, { department: "medical" });
    const inactiveSupervisor = user("inactive-supervisor", "Medical Supervisor", manager.id, { active: false, department: "medical" });
    const hiddenRep = user("hidden-rep", "Medical Representative", inactiveSupervisor.id, { department: "medical" });
    const salesRep = user("sales-rep", "Sales Representative", manager.id, { department: "sales" });
    const requested = { territory: [] as string[][], product: [] as string[][] };
    const result = await resolveOperationalScopeForActor(manager.id, {}, scopeRepository({
      actor: manager,
      users: [manager, activeRep, inactiveSupervisor, hiddenRep, salesRep],
      territoryAssignments: [territory("TA", activeRep.id, "A1", "CT1"), territory("TH", hiddenRep.id, "A2", "CT2"), territory("TS", salesRep.id, "A3", "CT3")],
      productAssignments: [product("PA", activeRep.id, "P1", "PG1"), product("PH", hiddenRep.id, "P2", "PG2"), product("PS", salesRep.id, "P3", "PG3")],
      requested,
    }));
    expect(requested.territory).toEqual([[activeRep.id]]);
    expect(result.areaIds).toEqual(["A1"]);
    expect(result.productIds).toEqual(["P1"]);
  });

  it("preserves sales department isolation", async () => {
    const manager = user("sales-manager", "Sales Manager", "", { department: "sales" });
    const salesRep = user("sales-rep", "Sales Representative", manager.id, { department: "sales" });
    const medicalRep = user("medical-rep", "Medical Representative", manager.id, { department: "medical" });
    const result = await resolveOperationalScopeForActor(manager.id, {}, scopeRepository({
      actor: manager,
      users: [manager, salesRep, medicalRep],
      territoryAssignments: [territory("TS", salesRep.id, "A1", "CT1"), territory("TM", medicalRep.id, "A2", "CT2")],
      productAssignments: [product("PS", salesRep.id, "P1", "PG1"), product("PM", medicalRep.id, "P2", "PG2")],
    }));
    expect(result.subjectUids).toEqual([manager.id, salesRep.id]);
    expect(result.areaIds).toEqual(["A1"]);
    expect(result.productIds).toEqual(["P1"]);
  });

  it("preserves cross-department hierarchy policy", async () => {
    const manager = user("country-manager", "Country Manager");
    const medicalRep = user("medical-rep", "Medical Representative", manager.id, { department: "medical" });
    const salesRep = user("sales-rep", "Sales Representative", manager.id, { department: "sales" });
    const result = await resolveOperationalScopeForActor(manager.id, {}, scopeRepository({
      actor: manager,
      users: [manager, medicalRep, salesRep],
      territoryAssignments: [territory("TM", medicalRep.id, "A1", "CT1"), territory("TS", salesRep.id, "A2", "CT2")],
      productAssignments: [product("PM", medicalRep.id, "P1", "PG1"), product("PS", salesRep.id, "P2", "PG2")],
    }));
    expect(result.areaIds).toEqual(["A1", "A2"]);
    expect(result.productIds).toEqual(["P1", "P2"]);
  });

  it("preserves SELF, ORGANIZATION, NONE, and active governance override source modes", async () => {
    const selfActor = user("product-manager", "Product Manager");
    const selfRequested = { territory: [] as string[][], product: [] as string[][] };
    const selfResult = await resolveOperationalScopeForActor(selfActor.id, {}, scopeRepository({
      actor: selfActor,
      users: [selfActor],
      territoryAssignments: [territory("TS", selfActor.id, "A1", "CT1")],
      productAssignments: [product("PS", selfActor.id, "P1", "PG1")],
      requested: selfRequested,
    }));
    expect(selfRequested).toEqual({ territory: [[selfActor.id]], product: [[selfActor.id]] });
    expect(selfResult.productIds).toEqual(["P1"]);

    const admin = user("admin", "Admin");
    const orgRep = user("org-rep", "Medical Representative", admin.id);
    const orgRequested = { territory: [] as string[][], product: [] as string[][] };
    const orgResult = await resolveOperationalScopeForActor(admin.id, {}, scopeRepository({
      actor: admin,
      users: [admin, orgRep],
      territoryAssignments: [territory("TO", orgRep.id, "A2", "CT2")],
      productAssignments: [product("PO", orgRep.id, "P2", "PG2")],
      requested: orgRequested,
    }));
    expect(orgRequested).toEqual({ territory: [[admin.id, orgRep.id]], product: [[admin.id, orgRep.id]] });
    expect(orgResult.productIds).toEqual(["P2"]);

    const finance = user("finance", "Finance Manager");
    const noneRequested = { territory: [] as string[][], product: [] as string[][] };
    const noneResult = await resolveOperationalScopeForActor(finance.id, {}, scopeRepository({
      actor: finance,
      users: [finance],
      territoryAssignments: [territory("TF", finance.id, "A3", "CT3")],
      productAssignments: [product("PF", finance.id, "P3", "PG3")],
      requested: noneRequested,
    }));
    expect(noneRequested).toEqual({ territory: [[finance.id]], product: [[]] });
    expect(noneResult.productIds).toEqual([]);

    const governed = user("governed-manager", "Medical Manager");
    const governedRep = user("governed-rep", "Medical Representative", governed.id);
    const governedRequested = { territory: [] as string[][], product: [] as string[][] };
    const governedResult = await resolveOperationalScopeForActor(governed.id, {}, scopeRepository({
      actor: governed,
      users: [governed, governedRep],
      territoryAssignments: [territory("TG", governed.id, "A1", "CT1"), territory("TR", governedRep.id, "A2", "CT2")],
      productAssignments: [product("PG", governed.id, "P1", "PG1"), product("PR", governedRep.id, "P2", "PG2")],
      governance: { active: true, scopePolicy: { geographySource: "SELF", productSource: "SELF" } },
      requested: governedRequested,
    }));
    expect(governedRequested).toEqual({ territory: [[governed.id]], product: [[governed.id]] });
    expect(governedResult.areaIds).toEqual(["A1"]);
    expect(governedResult.productIds).toEqual(["P1"]);
  });
});

describe("bounded canonical actor market transport", () => {
  const market = (marketId = "SYNTH-M1", patch: Record<string, unknown> = {}) => ({ marketId, countryId: "SYNTH-C1", countryNameEn: "Synthetic Country", countryNameAr: "بلد", active: true, currencyCode: "TST", currencySymbol: "T", symbolPosition: "BEFORE", decimalPlaces: 2, numeralLocale: "en-US", timezone: "UTC", dateFormat: "YYYY-MM-DD", timeFormat: "24H", weekStartDay: 1, workingWeekdays: [1,2,3,4,5], normalWorkdayStart: "09:00", normalWorkdayEnd: "17:00", checkInOpensAt: "08:00", lateToleranceMinutes: 5, autoCheckoutAt: "18:00", maximumWorkdayMinutes: 600, ...patch });
  const db = (records: ReturnType<typeof market>[]) => {
    const snapshot = (row: ReturnType<typeof market>) => ({ id: row.marketId, exists: true, data: () => row });
    const query: any = { where: vi.fn(() => query), limit: vi.fn(() => query), get: vi.fn(async () => ({ docs: records.map(snapshot) })), doc: vi.fn((id: string) => ({ get: async () => records.find(r => r.marketId === id) ? snapshot(records.find(r => r.marketId === id)!) : { exists: false } })) };
    return { collection: vi.fn(() => query), query };
  };
  it("resolves an exact current actor market with one exact read", async () => {
    const { readActorMarketContext } = await import("./operationalScopeRepository");
    const store = db([market(), market("SYNTH-M2", { currencyCode: "ZZZ" })]);
    const result = await readActorMarketContext({ marketId: "SYNTH-M2" }, store as any);
    expect(result).toMatchObject({ status: "RESOLVED", market: { marketId: "SYNTH-M2", currencyCode: "ZZZ" } });
    expect(store.query.doc).toHaveBeenCalledWith("SYNTH-M2"); expect(store.query.where).not.toHaveBeenCalled();
  });
  it.each([[], [market(), market("SYNTH-M2")]])("fails closed for missing/ambiguous country market", async records => {
    const { readActorMarketContext } = await import("./operationalScopeRepository");
    const store = db(records);
    expect(await readActorMarketContext({ countryId: "SYNTH-C1" }, store as any)).toEqual({ status: "UNRESOLVED" });
    expect(store.query.limit).toHaveBeenCalledWith(2);
  });
  it.each([{ active: false }, { currencyCode: "" }, { currencyCode: "bad" }, { currencySymbol: null }])("rejects invalid market/currency %j", async patch => {
    const { readActorMarketContext } = await import("./operationalScopeRepository");
    expect(await readActorMarketContext({ marketId: "SYNTH-M1" }, db([market("SYNTH-M1", patch)]) as any)).toEqual({ status: "UNRESOLVED" });
  });
  it.each([
    ["zero", [], "UNRESOLVED"],
    ["one", [market()], "RESOLVED"],
    ["multiple", [market(), market("SYNTH-M2")], "UNRESOLVED"],
    ["inactive", [market("SYNTH-M1", { active: false })], "UNRESOLVED"],
    ["malformed", [market("SYNTH-M1", { timezone: "Invalid/Zone" })], "UNRESOLVED"],
    ["invalid currency", [market("SYNTH-M1", { currencyCode: "bad" })], "UNRESOLVED"],
  ])("endpoint preserves bounded market %s behavior", async (_name, records, status) => {
    const { readActorMarketContext } = await import("./operationalScopeRepository");
    const store = db(records as ReturnType<typeof market>[]);
    const result = await runMarketEndpoint({ authorized: true, actorUid: "MANAGER", countryIds: ["SYNTH-C1"], subjectUids: [], areaIds: [], productIds: [], queryPlan: { denyAll: false } }, (identity: any) => readActorMarketContext(identity, store as any));
    expect(result.marketContext.status).toBe(status);
    if (status === "RESOLVED") expect(result.marketContext.market.currencyCode).toBe("TST");
    expect(store.query.where).toHaveBeenCalledWith("countryId", "==", "SYNTH-C1");
    expect(store.query.limit).toHaveBeenCalledWith(2);
  });
  it("fails closed on market read failure", async () => {
    const { readActorMarketContext } = await import("./operationalScopeRepository");
    const store = db([]);
    store.query.get.mockRejectedValue(new Error("synthetic unavailable"));
    expect(await readActorMarketContext({ countryId: "SYNTH-C1" }, store as any)).toEqual({ status: "UNRESOLVED" });
  });
  it("does not infer market from Product or descendant data", async () => {
    const { readActorMarketContext } = await import("./operationalScopeRepository");
    const store = db([market()]);
    expect(await readActorMarketContext({ product: { marketId: "SYNTH-M1" }, assignedCountries: ["SYNTH-C1"] }, store as any)).toEqual({ status: "UNRESOLVED" });
    expect(store.collection).not.toHaveBeenCalled();
  });
});

it("Sales Manager preserves DESCENDANTS without a SELF union or unrelated branch", async () => {
  const users: any[] = [
    { id: "MANAGER", role: "Sales Manager", active: true },
    { id: "SUPERVISOR", role: "Sales Supervisor", managerId: "MANAGER", active: true },
    { id: "REP", role: "Sales Representative", managerId: "SUPERVISOR", active: true },
    { id: "DIRECT", role: "Sales Representative", managerId: "MANAGER", active: true },
    { id: "UNRELATED", role: "Sales Representative", managerId: "OTHER-MANAGER", active: true },
  ];
  const assignments = ["MANAGER", "REP", "DIRECT", "UNRELATED"].map(userId => ({ assignmentId: `ASSIGN-${userId}`, userId, productId: `PRODUCT-${userId}`, productGroupId: "GROUP", status: "Active", active: true, effectiveFrom: "2020-01-01", effectiveTo: "2099-01-01", assignedAt: "2020-01-01", assignedBy: "SYNTH-ADMIN" }));
  const getProductAssignments = vi.fn(async () => assignments);
  const node = { countryId: "COUNTRY", regionId: "DISTRICT", districtId: "DISTRICT", cityId: "CITY", areaId: "AREA", active: true };
  const repo: any = {
    hierarchy: { getUser: async (id: string) => users.find(u => u.id === id) || null, getDirectReports: async (id: string) => users.filter(u => u.managerId === id), getAllUsers: vi.fn(), getRolePermissions: async () => ({ viewTeamData: true }) },
    getGeographyCatalog: async () => ({ nodes: [node], countries: [], districts: [], cities: [], areas: [] }),
    getTerritoryAssignments: async () => [{ assignmentId: "TERRITORY", userId: "REP", ...node, status: "Active" }],
    getProductAssignments,
    getProducts: async () => assignments.map(a => ({ id: a.productId, name: a.productId, brand: "Synthetic", sku: a.productId, promotionGroupId: "GROUP", isActive: true, price: 1 })),
  };
  const result = await resolveOperationalScopeForActor("MANAGER", {}, repo);
  expect(result.authorized).toBe(true);
  expect(result.productIds).toEqual(["PRODUCT-DIRECT", "PRODUCT-REP"]);
  expect(result.countryIds).toEqual(["COUNTRY"]);
  const marketReader = vi.fn(async () => ({ status: "RESOLVED", market: { currencyCode: "TST" } }));
  expect((await runMarketEndpoint(result, marketReader)).marketContext.status).toBe("RESOLVED");
  expect(marketReader).toHaveBeenCalledExactlyOnceWith({ countryId: "COUNTRY" }, {});
  expect(getProductAssignments).toHaveBeenCalledWith(["DIRECT", "REP", "SUPERVISOR"]);
  expect(repo.hierarchy.getAllUsers).not.toHaveBeenCalled();
});

// Execute the actual registered handler without starting the production server.
async function runMarketEndpoint(scope: any, readMarket: any, resolve = vi.fn(async () => scope)) {
  const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const start = source.indexOf('  app.post("/api/operational-scope"');
  const end = source.indexOf("\n  });", start) + "\n  });".length;
  expect(start).toBeGreaterThan(0);
  const code = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText;
  let handler: any;
  new Function("app", "requireFirebaseAuth", "resolveOperationalScopeForActor", "createFirestoreOperationalScopeRepository", "readActorMarketContext", "firebaseAdmin", "console", code)(
    { post: (_path: string, _auth: unknown, callback: any) => { handler = callback; } }, () => {}, resolve, () => ({}), readMarket, { db: {} }, { info: () => {} },
  );
  let payload: any;
  const res: any = { status: vi.fn(() => res), json: (value: any) => { payload = value; } };
  await handler({ authUid: "MANAGER", body: {}, user: { marketId: "PROFILE-MARKET", countryId: "PROFILE-COUNTRY", country: "Free text" } }, res);
  expect(resolve).toHaveBeenCalledTimes(1);
  return payload;
}

describe("operational-scope endpoint effective geography composition", () => {
  const scope = (patch: any = {}) => ({ authorized: true, actorUid: "MANAGER", countryIds: ["COUNTRY"], subjectUids: [], areaIds: [], productIds: [], queryPlan: { denyAll: false }, ...patch });
  it("uses only the already-resolved country, ignoring all direct profile market fields", async () => {
    const market = vi.fn(async () => ({ status: "RESOLVED", market: { currencyCode: "TST" } }));
    const result = await runMarketEndpoint(scope(), market);
    expect(market).toHaveBeenCalledExactlyOnceWith({ countryId: "COUNTRY" }, {});
    expect(result.marketContext).toMatchObject({ status: "RESOLVED", market: { currencyCode: "TST" } });
  });
  it.each([
    { countryIds: [] }, { countryIds: ["C1", "C2"] }, { authorized: false },
    { queryPlan: { denyAll: true } }, { actorUid: "OTHER" }, { countryIds: [""] }, { countryIds: [" C1"] }, { countryIds: ["C/1"] },
  ])("fails closed without a market read for %j", async patch => {
    const market = vi.fn();
    expect((await runMarketEndpoint(scope(patch), market)).marketContext).toEqual({ status: "UNRESOLVED" });
    expect(market).not.toHaveBeenCalled();
  });
});
