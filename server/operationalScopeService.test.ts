import { describe, expect, it } from "vitest";
import {
  OperationalScopeError,
  resolveOperationalScope,
  type CanonicalGeographyNode,
  type OperationalActor,
  type OperationalProductAssignment,
  type OperationalTerritoryAssignment,
  type ResolveOperationalScopeInput,
} from "./operationalScopeService";

const NOW = "2026-08-10T12:00:00.000Z";

const geographyRegistry: CanonicalGeographyNode[] = [
  { countryId: "C1", regionId: "R1", districtId: "D1", cityId: "CT1", areaId: "A1", active: true },
  { countryId: "C1", regionId: "R1", districtId: "D1", cityId: "CT2", areaId: "A2", active: true },
  { countryId: "C1", regionId: "R2", districtId: "D2", cityId: "CT3", areaId: "A3", active: true },
  { countryId: "C2", regionId: "R3", districtId: "D3", cityId: "CT4", areaId: "A4", active: true },
  { countryId: "C2", regionId: "R4", districtId: "D4", cityId: "CT5", areaId: "A5", active: true },
  { countryId: "C1", regionId: "R1", districtId: "D1", cityId: "CT6", areaId: "A-INACTIVE", active: false },
];

function actor(overrides: Partial<OperationalActor> = {}): OperationalActor {
  return {
    id: "actor-1",
    role: "Medical Manager",
    active: true,
    loginAllowed: true,
    isDeleted: false,
    status: "Active",
    configuredBoundary: { kind: "AREA", countryIds: [], regionIds: [], areaIds: ["A1"] },
    ...overrides,
  };
}

function assignment(
  assignmentId: string,
  areaId: string,
  overrides: Partial<OperationalTerritoryAssignment> = {},
): OperationalTerritoryAssignment {
  const geo = geographyRegistry.find((node) => node.areaId === areaId);
  return {
    assignmentId,
    userId: "actor-1",
    status: "Active",
    active: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2026-12-31T23:59:59.999Z",
    countryId: geo?.countryId,
    regionId: geo?.regionId,
    districtId: geo?.districtId,
    cityId: geo?.cityId,
    territoryId: areaId,
    areaId,
    ...overrides,
  };
}

function productAssignment(
  assignmentId: string,
  productId: string,
  overrides: Partial<OperationalProductAssignment> = {},
): OperationalProductAssignment {
  return {
    assignmentId,
    userId: "actor-1",
    productId,
    productGroupId: `PG-${productId}`,
    status: "Active",
    active: true,
    ...overrides,
  };
}

function input(overrides: Partial<ResolveOperationalScopeInput> = {}): ResolveOperationalScopeInput {
  return {
    authenticatedActorUid: "actor-1",
    requestedActorUid: "actor-1",
    actor: actor(),
    now: NOW,
    geographyRegistry,
    territoryAssignments: [assignment("TA-1", "A1")],
    productAssignments: [],
    hierarchy: {
      mode: "HIERARCHY",
      actorUid: "actor-1",
      directReportUids: [],
      descendantUids: [],
      allowedSubjectUids: ["actor-1"],
    },
    ...overrides,
  };
}

function expectDenied(result: ReturnType<typeof resolveOperationalScope>, code: string): void {
  expect(result.authorized).toBe(false);
  expect(result.code).toBe(code);
  expect(result.subjectUids).toEqual([]);
  expect(result.countryIds).toEqual([]);
  expect(result.regionIds).toEqual([]);
  expect(result.districtIds).toEqual([]);
  expect(result.cityIds).toEqual([]);
  expect(result.areaIds).toEqual([]);
  expect(result.productIds).toEqual([]);
  expect(result.productGroupIds).toEqual([]);
  expect(result.queryPlan.denyAll).toBe(true);
}

describe("WP5.2E operational scope certification contract — 50 requirements", () => {
  it("Requirement 1 — Missing authenticated UID denies", () => {
    expectDenied(resolveOperationalScope(input({ authenticatedActorUid: null })), "UNAUTHENTICATED");
  });

  it("Requirement 2 — Requested actor UID mismatch denies", () => {
    expectDenied(resolveOperationalScope(input({ requestedActorUid: "different-actor" })), "ACTOR_UID_MISMATCH");
  });

  it("Requirement 3 — Missing actor profile denies", () => {
    expectDenied(resolveOperationalScope(input({ actor: null })), "ACTOR_NOT_FOUND");
  });

  it("Requirement 4 — Inactive actor denies", () => {
    expectDenied(resolveOperationalScope(input({ actor: actor({ active: false }) })), "ACTOR_INACTIVE");
  });

  it("Requirement 5 — Login-disabled actor denies", () => {
    expectDenied(resolveOperationalScope(input({ actor: actor({ loginAllowed: false }) })), "ACTOR_INACTIVE");
  });

  it("Requirement 6 — Deleted or archived actor denies", () => {
    expectDenied(resolveOperationalScope(input({ actor: actor({ isDeleted: true }) })), "ACTOR_INACTIVE");
    expectDenied(resolveOperationalScope(input({ actor: actor({ status: "Archived" }) })), "ACTOR_INACTIVE");
  });

  it("Requirement 7 — Unsupported role denies operational resolution", () => {
    expectDenied(resolveOperationalScope(input({ actor: actor({ role: "Unknown Role" }) })), "UNSUPPORTED_ROLE");
  });

  it("Requirement 8 — Missing configured scope type denies", () => {
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary: undefined }) })), "MISSING_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 9 — Unknown configured scope type denies", () => {
    const configuredBoundary = { kind: "UNBOUNDED", countryIds: [], regionIds: [], areaIds: [] } as never;
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary }) })), "INVALID_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 10 — Resolver invariant failure exposes no partial scope", () => {
    expect(() => resolveOperationalScope(input({ geographyRegistry: null as never }))).toThrow(OperationalScopeError);
  });

  it("Requirement 11 — AREA with no configured area IDs denies", () => {
    const configuredBoundary = { kind: "AREA" as const, countryIds: [], regionIds: [], areaIds: [] };
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary }) })), "MISSING_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 12 — COUNTRY with no configured country IDs denies", () => {
    const configuredBoundary = { kind: "COUNTRY" as const, countryIds: [], regionIds: [], areaIds: [] };
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary }) })), "MISSING_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 13 — REGION with no configured region IDs denies", () => {
    const configuredBoundary = { kind: "REGION" as const, countryIds: ["C1"], regionIds: [], areaIds: [] };
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary }) })), "MISSING_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 14 — GLOBAL with no explicit coverage denies", () => {
    const configuredBoundary = { kind: "GLOBAL" as const, countryIds: [], regionIds: [], areaIds: [] };
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary }) })), "MISSING_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 15 — Unknown configured geography ID denies", () => {
    const configuredBoundary = { kind: "AREA" as const, countryIds: [], regionIds: [], areaIds: ["A-UNKNOWN"] };
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary }) })), "INVALID_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 16 — Ambiguous geography identity denies", () => {
    const ambiguousRegistry = [...geographyRegistry, { ...geographyRegistry[0], countryId: "C2" }];
    expectDenied(resolveOperationalScope(input({ geographyRegistry: ambiguousRegistry })), "INVALID_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 17 — Inactive geography registry node denies", () => {
    const configuredBoundary = { kind: "AREA" as const, countryIds: [], regionIds: [], areaIds: ["A-INACTIVE"] };
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments: [assignment("TA-I", "A-INACTIVE")] })), "INVALID_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 18 — Area without complete canonical ancestry denies", () => {
    const malformedRegistry = [{ countryId: "C1", regionId: "R1", districtId: "", cityId: "", areaId: "A1", active: true }];
    expectDenied(resolveOperationalScope(input({ geographyRegistry: malformedRegistry })), "INVALID_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 19 — AREA retains a matching active assignment", () => {
    const result = resolveOperationalScope(input());
    expect(result.authorized).toBe(true);
    expect(result.areaIds).toEqual(["A1"]);
  });

  it("Requirement 20 — AREA excludes an assignment outside the configured area", () => {
    const result = resolveOperationalScope(input({ territoryAssignments: [assignment("TA-1", "A1"), assignment("TA-2", "A2")] }));
    expect(result.areaIds).toEqual(["A1"]);
    expect(result.diagnostics.outsideBoundaryAssignmentIds).toEqual(["TA-2"]);
  });

  it("Requirement 21 — AREA with no assignments returns empty", () => {
    expectDenied(resolveOperationalScope(input({ territoryAssignments: [] })), "NO_ACTIVE_ASSIGNMENTS");
  });

  it("Requirement 22 — AREA with only outside assignments returns empty", () => {
    expectDenied(resolveOperationalScope(input({ territoryAssignments: [assignment("TA-2", "A2")] })), "NO_ASSIGNMENTS_WITHIN_BOUNDARY");
  });

  it("Requirement 23 — Multiple configured areas retain only matching assignments", () => {
    const configuredBoundary = { kind: "AREA" as const, countryIds: [], regionIds: [], areaIds: ["A1", "A2"] };
    const territoryAssignments = [assignment("TA-4", "A4"), assignment("TA-2", "A2"), assignment("TA-1", "A1")];
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments }));
    expect(result.areaIds).toEqual(["A1", "A2"]);
  });

  it("Requirement 24 — Duplicate configured areas normalize deterministically", () => {
    const configuredBoundary = { kind: "AREA" as const, countryIds: [], regionIds: [], areaIds: ["A2", "A1", "A2", "A1"] };
    const territoryAssignments = [assignment("TA-2", "A2"), assignment("TA-1", "A1")];
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments }));
    expect(result.areaIds).toEqual(["A1", "A2"]);
  });

  it("Requirement 25 — COUNTRY retains assignments inside the configured country", () => {
    const configuredBoundary = { kind: "COUNTRY" as const, countryIds: ["C1"], regionIds: [], areaIds: [] };
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments: [assignment("TA-3", "A3")] }));
    expect(result.countryIds).toEqual(["C1"]);
    expect(result.areaIds).toEqual(["A3"]);
  });

  it("Requirement 26 — COUNTRY excludes assignments from another country", () => {
    const configuredBoundary = { kind: "COUNTRY" as const, countryIds: ["C1"], regionIds: [], areaIds: [] };
    const territoryAssignments = [assignment("TA-1", "A1"), assignment("TA-4", "A4")];
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments }));
    expect(result.countryIds).toEqual(["C1"]);
    expect(result.areaIds).toEqual(["A1"]);
  });

  it("Requirement 27 — COUNTRY excludes a cross-country descendant", () => {
    const configuredBoundary = { kind: "COUNTRY" as const, countryIds: ["C1"], regionIds: [], areaIds: [] };
    const hierarchy = { mode: "HIERARCHY" as const, actorUid: "actor-1", directReportUids: ["rep-c2"], descendantUids: ["rep-c2"], allowedSubjectUids: ["actor-1", "rep-c2"] };
    const territoryAssignments = [assignment("TA-1", "A1"), assignment("TA-C2", "A4", { userId: "rep-c2" })];
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), hierarchy, territoryAssignments }));
    expect(result.areaIds).toEqual(["A1"]);
    expect(result.diagnostics.outsideBoundaryAssignmentIds).toEqual(["TA-C2"]);
  });

  it("Requirement 28 — COUNTRY inherits canonical subordinate region, district, city, and area IDs", () => {
    const configuredBoundary = { kind: "COUNTRY" as const, countryIds: ["C1"], regionIds: [], areaIds: [] };
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments: [assignment("TA-3", "A3")] }));
    expect(result).toMatchObject({ countryIds: ["C1"], regionIds: ["R2"], districtIds: ["D2"], cityIds: ["CT3"], areaIds: ["A3"] });
  });

  it("Requirement 29 — Area/Territory Product Manager geographic boundary", () => {
    const configuredBoundary = { kind: "AREA" as const, countryIds: [], regionIds: [], areaIds: ["A1"] };
    const productManager = actor({ role: "Product Manager", configuredBoundary });
    const activeAssignments = [assignment("TA-A1", "A1"), assignment("TA-A2", "A2")];

    const result = resolveOperationalScope(input({ actor: productManager, territoryAssignments: activeAssignments }));

    // configuredBoundary ∩ activeAssignments, never configuredBoundary ∪ activeAssignments
    expect(result.areaIds).toEqual(["A1"]);
  });

  it("Requirement 30 — REGION retains assignments inside the configured region", () => {
    const configuredBoundary = { kind: "REGION" as const, countryIds: ["C1"], regionIds: ["R1"], areaIds: [] };
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments: [assignment("TA-2", "A2")] }));
    expect(result.regionIds).toEqual(["R1"]);
    expect(result.areaIds).toEqual(["A2"]);
  });

  it("Requirement 31 — REGION excludes assignments in another region", () => {
    const configuredBoundary = { kind: "REGION" as const, countryIds: ["C1"], regionIds: ["R1"], areaIds: [] };
    const territoryAssignments = [assignment("TA-1", "A1"), assignment("TA-3", "A3")];
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments }));
    expect(result.areaIds).toEqual(["A1"]);
  });

  it("Requirement 32 — REGION excludes same-named geography represented by a different canonical ID", () => {
    const configuredBoundary = { kind: "REGION" as const, countryIds: ["C1"], regionIds: ["R1"], areaIds: [] };
    const misleadingAssignment = assignment("TA-MISLEADING", "A4", { territoryName: "A1" });
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments: [assignment("TA-1", "A1"), misleadingAssignment] }));
    expect(result.areaIds).toEqual(["A1"]);
  });

  it("Requirement 33 — REGION missing country linkage denies", () => {
    const configuredBoundary = { kind: "REGION" as const, countryIds: [], regionIds: ["R1"], areaIds: [] };
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary }) })), "INVALID_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 34 — REGION result derives canonical country ancestry", () => {
    const configuredBoundary = { kind: "REGION" as const, countryIds: ["C1"], regionIds: ["R1"], areaIds: [] };
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments: [assignment("TA-2", "A2")] }));
    expect(result.countryIds).toEqual(["C1"]);
  });

  it("Requirement 35 — GLOBAL explicit C1/C2 coverage excludes C3", () => {
    const registry = [...geographyRegistry, { countryId: "C3", regionId: "R5", districtId: "D5", cityId: "CT7", areaId: "A6", active: true }];
    const configuredBoundary = { kind: "GLOBAL" as const, countryIds: ["C1", "C2"], regionIds: [], areaIds: [] };
    const territoryAssignments = [assignment("TA-1", "A1"), assignment("TA-4", "A4"), { ...assignment("TA-6", "A6"), countryId: "C3", regionId: "R5", districtId: "D5", cityId: "CT7" }];
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), geographyRegistry: registry, territoryAssignments }));
    expect(result.countryIds).toEqual(["C1", "C2"]);
    expect(result.areaIds).toEqual(["A1", "A4"]);
  });

  it("Requirement 36 — GLOBAL never emits an unrestricted or scan-all query plan", () => {
    const configuredBoundary = { kind: "GLOBAL" as const, countryIds: ["C1", "C2"], regionIds: [], areaIds: [] };
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments: [assignment("TA-1", "A1"), assignment("TA-4", "A4")] }));
    expect(result.authorized).toBe(true);
    expect(result.queryPlan.denyAll).toBe(false);
    expect(result.queryPlan.areaIdChunks.flat()).toEqual(["A1", "A4"]);
    expect(result.queryPlan).not.toHaveProperty("unrestricted", true);
    expect(result.queryPlan).not.toHaveProperty("scanAll", true);
  });

  it("Requirement 37 — GLOBAL with empty assignments returns empty", () => {
    const configuredBoundary = { kind: "GLOBAL" as const, countryIds: ["C1"], regionIds: [], areaIds: [] };
    expectDenied(resolveOperationalScope(input({ actor: actor({ configuredBoundary }), territoryAssignments: [] })), "NO_ACTIVE_ASSIGNMENTS");
  });

  it("Requirement 38 — General Manager GLOBAL remains explicitly bounded", () => {
    const configuredBoundary = { kind: "GLOBAL" as const, countryIds: ["C1"], regionIds: [], areaIds: [] };
    const territoryAssignments = [assignment("TA-1", "A1"), assignment("TA-4", "A4")];
    const result = resolveOperationalScope(input({ actor: actor({ role: "General Manager", configuredBoundary }), territoryAssignments }));
    expect(result.countryIds).toEqual(["C1"]);
    expect(result.areaIds).toEqual(["A1"]);
  });

  it("Requirement 39 — Admin and Super Admin operational scopes remain explicitly bounded", () => {
    const configuredBoundary = { kind: "GLOBAL" as const, countryIds: ["C2"], regionIds: [], areaIds: [] };
    const territoryAssignments = [assignment("TA-1", "A1"), assignment("TA-4", "A4")];
    for (const role of ["Admin", "Super Admin"]) {
      const result = resolveOperationalScope(input({ actor: actor({ role, configuredBoundary }), territoryAssignments }));
      expect(result.countryIds).toEqual(["C2"]);
      expect(result.areaIds).toEqual(["A4"]);
    }
  });

  it("Requirement 40 — Product Manager never gains GLOBAL coverage from role alone", () => {
    expectDenied(resolveOperationalScope(input({ actor: actor({ role: "Product Manager", configuredBoundary: undefined }) })), "MISSING_CONFIGURED_GEOGRAPHY");
  });

  it("Requirement 41 — Inactive assignment is excluded", () => {
    const territoryAssignments = [assignment("TA-INACTIVE", "A1", { status: "Inactive" })];
    expectDenied(resolveOperationalScope(input({ territoryAssignments })), "NO_ACTIVE_ASSIGNMENTS");
  });

  it("Requirement 42 — Explicit active false assignment is excluded", () => {
    const territoryAssignments = [assignment("TA-DISABLED", "A1", { active: false })];
    expectDenied(resolveOperationalScope(input({ territoryAssignments })), "NO_ACTIVE_ASSIGNMENTS");
  });

  it("Requirement 43 — Not-yet-effective assignment is excluded", () => {
    const territoryAssignments = [assignment("TA-FUTURE", "A1", { effectiveFrom: "2026-09-01T00:00:00.000Z" })];
    expectDenied(resolveOperationalScope(input({ territoryAssignments })), "NO_ACTIVE_ASSIGNMENTS");
  });

  it("Requirement 44 — Expired assignment is excluded", () => {
    const territoryAssignments = [assignment("TA-EXPIRED", "A1", { effectiveTo: "2026-08-09T23:59:59.999Z" })];
    expectDenied(resolveOperationalScope(input({ territoryAssignments })), "NO_ACTIVE_ASSIGNMENTS");
  });

  it("Requirement 45 — Malformed assignment is excluded without widening", () => {
    const malformed = assignment("TA-MALFORMED", "A1", { areaId: "", territoryId: "", countryId: "C2" });
    const result = resolveOperationalScope(input({ territoryAssignments: [assignment("TA-1", "A1"), malformed] }));
    expect(result.areaIds).toEqual(["A1"]);
    expect(result.diagnostics.malformedAssignmentIds).toEqual(["TA-MALFORMED"]);
  });

  it("Requirement 46 — Duplicate assignments produce one canonical geography entry", () => {
    const territoryAssignments = [assignment("TA-Z", "A1"), assignment("TA-A", "A1"), assignment("TA-Z", "A1")];
    const result = resolveOperationalScope(input({ territoryAssignments }));
    expect(result.areaIds).toEqual(["A1"]);
  });

  it("Requirement 47 — Representative uses SELF scope and cannot enumerate descendants", () => {
    const representative = actor({ role: "Medical Representative" });
    const hierarchy = { mode: "SELF" as const, actorUid: "actor-1", directReportUids: [], descendantUids: ["rep-child"], allowedSubjectUids: ["actor-1"] };
    const territoryAssignments = [assignment("TA-SELF", "A1"), assignment("TA-CHILD", "A1", { userId: "rep-child" })];
    const result = resolveOperationalScope(input({ actor: representative, hierarchy, territoryAssignments }));
    expect(result.subjectUids).toEqual(["actor-1"]);
    expect(result.diagnostics.excludedAssignmentIds).toContain("TA-CHILD");
  });

  it("Requirement 48 — Manager includes only authorized descendants intersecting the manager boundary", () => {
    const configuredBoundary = { kind: "AREA" as const, countryIds: [], regionIds: [], areaIds: ["A1", "A2"] };
    const hierarchy = { mode: "HIERARCHY" as const, actorUid: "actor-1", directReportUids: ["rep-1"], descendantUids: ["rep-1"], allowedSubjectUids: ["actor-1", "rep-1"] };
    const territoryAssignments = [
      assignment("TA-REP-1", "A2", { userId: "rep-1" }),
      assignment("TA-OUTSIDE-SUBJECT", "A1", { userId: "rep-unrelated" }),
      assignment("TA-OUTSIDE-BOUNDARY", "A3", { userId: "rep-1" }),
    ];
    const result = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), hierarchy, territoryAssignments }));
    expect(result.subjectUids).toEqual(["actor-1", "rep-1"]);
    expect(result.areaIds).toEqual(["A2"]);
  });

  it("Requirement 49 — Supervisor country boundary excludes subordinate assignments in another country", () => {
    const configuredBoundary = { kind: "COUNTRY" as const, countryIds: ["C1"], regionIds: [], areaIds: [] };
    const supervisor = actor({ role: "Medical Supervisor", configuredBoundary });
    const hierarchy = { mode: "HIERARCHY" as const, actorUid: "actor-1", directReportUids: ["rep-1", "rep-2"], descendantUids: ["rep-1", "rep-2"], allowedSubjectUids: ["actor-1", "rep-1", "rep-2"] };
    const territoryAssignments = [assignment("TA-C1", "A1", { userId: "rep-1" }), assignment("TA-C2", "A4", { userId: "rep-2" })];
    const result = resolveOperationalScope(input({ actor: supervisor, hierarchy, territoryAssignments }));
    expect(result.countryIds).toEqual(["C1"]);
    expect(result.areaIds).toEqual(["A1"]);
  });

  it("Requirement 50 — Output is stable, deduplicated, and sorted regardless of input order", () => {
    const configuredBoundary = { kind: "GLOBAL" as const, countryIds: ["C2", "C1", "C1"], regionIds: [], areaIds: [] };
    const hierarchy = { mode: "HIERARCHY" as const, actorUid: "actor-1", directReportUids: ["rep-b", "rep-a"], descendantUids: ["rep-b", "rep-a", "rep-b"], allowedSubjectUids: ["rep-b", "actor-1", "rep-a", "rep-b"] };
    const territoryAssignments = [assignment("TA-4", "A4", { userId: "rep-b" }), assignment("TA-2", "A2", { userId: "rep-a" }), assignment("TA-1", "A1"), assignment("TA-2", "A2", { userId: "rep-a" })];
    const productAssignments = [productAssignment("PA-2", "P2", { userId: "rep-b" }), productAssignment("PA-1", "P1"), productAssignment("PA-1-DUP", "P1")];
    const forward = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), hierarchy, territoryAssignments, productAssignments }));
    const reverse = resolveOperationalScope(input({ actor: actor({ configuredBoundary }), hierarchy, territoryAssignments: [...territoryAssignments].reverse(), productAssignments: [...productAssignments].reverse() }));
    expect(forward).toEqual(reverse);
    expect(forward.subjectUids).toEqual(["actor-1", "rep-a", "rep-b"]);
    expect(forward.countryIds).toEqual(["C1", "C2"]);
    expect(forward.areaIds).toEqual(["A1", "A2", "A4"]);
    expect(forward.productIds).toEqual(["P1", "P2"]);
    expect(forward.productGroupIds).toEqual(["PG-P1", "PG-P2"]);
  });
});
