import { describe, expect, it, vi } from "vitest";
import { resolveWorkflowQueueScope } from "./workflowQueueScopeService";
import type { WorkflowQueueScopeRepository } from "./workflowQueueScopeRepository";

const actor = (overrides = {}) => ({
  id: "OPS1", role: "Order Operations Officer", active: true, loginAllowed: true,
  status: "Active", securityScope: "COUNTRY", country: "Libya", ...overrides,
});

const catalog = (overrides = {}) => ({
  countries: [{ id: "C-LIB", name: "Libya", active: true }],
  districts: [{ id: "D1", countryId: "C-LIB", active: true }],
  cities: [{ id: "CT1", countryId: "C-LIB", districtId: "D1", active: true }],
  areas: [{ id: "A2", countryId: "C-LIB", districtId: "D1", cityId: "CT1", active: true }, { id: "A1", countryId: "C-LIB", districtId: "D1", cityId: "CT1", active: true }],
  ...overrides,
});

function repository(actorOverrides = {}, catalogOverrides = {}): WorkflowQueueScopeRepository {
  return {
    getActor: vi.fn(async () => actor(actorOverrides)),
    getGeographyCatalog: vi.fn(async () => catalog(catalogOverrides)),
  };
}

const request = { resource: "orders" };

describe("WP5.2G.1 workflow queue scope", () => {
  it("1. authorizes an active Order Operations Officer", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository())).authorized).toBe(true));
  it("2. denies an inactive actor", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository({ active: false }))).code).toBe("ACTOR_INACTIVE"));
  it("3. denies a deleted or disabled actor", async () => {
    expect((await resolveWorkflowQueueScope("OPS1", request, repository({ isDeleted: true }))).code).toBe("ACTOR_INACTIVE");
    expect((await resolveWorkflowQueueScope("OPS1", request, repository({ loginAllowed: false }))).code).toBe("ACTOR_INACTIVE");
  });
  it("4. denies another role", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository({ role: "Finance Officer" }))).code).toBe("UNSUPPORTED_ROLE"));
  it("5. denies an unsupported resource", async () => expect((await resolveWorkflowQueueScope("OPS1", { resource: "payments" }, repository())).code).toBe("UNSUPPORTED_RESOURCE"));
  it("6. allows only the orders resource", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository())).resource).toBe("orders"));
  it("7. accepts configured Libya country", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository())).countryIds).toEqual(["C-LIB"]));
  it("8. denies a missing configured country", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository({ country: "" }))).code).toBe("MISSING_CONFIGURED_GEOGRAPHY"));
  it("9. denies an inactive country", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository({}, { countries: [{ id: "C-LIB", name: "Libya", active: false }] }))).code).toBe("INVALID_CONFIGURED_GEOGRAPHY"));
  it("10. expands only to active canonical areas", async () => {
    const result = await resolveWorkflowQueueScope("OPS1", request, repository({}, { areas: [...catalog().areas, { id: "A3", countryId: "C-LIB", districtId: "D1", cityId: "CT1", active: false }] }));
    expect(result.areaIds).toEqual(["A1", "A2"]);
  });
  it("11. denies when there are no active areas", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository({}, { areas: [] }))).code).toBe("NO_ACTIVE_AREAS"));
  it("12. does not require territory assignments", async () => expect(repository()).not.toHaveProperty("getTerritoryAssignments"));
  it("13. does not require product assignments", async () => expect(repository()).not.toHaveProperty("getProductAssignments"));
  it("14. ignores assignments so they cannot widen geography", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository({ areaIds: ["OUTSIDE"] }))).areaIds).toEqual(["A1", "A2"]));
  it("15. does not enumerate subject hierarchy", async () => expect(repository()).not.toHaveProperty("hierarchy"));
  it("16. does not require Users.view", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository({ permissions: { Users: { view: false } } }))).authorized).toBe(true));
  it("17. marks cross-subject records only on an authorized queue", async () => {
    expect((await resolveWorkflowQueueScope("OPS1", request, repository())).crossSubjectRecords).toBe(true);
    expect((await resolveWorkflowQueueScope("OPS1", request, repository({ role: "Finance Officer" }))).crossSubjectRecords).toBe(false);
  });
  it("18. grants no general user authority", async () => expect(await resolveWorkflowQueueScope("OPS1", request, repository())).not.toHaveProperty("subjectUids"));
  it("19. allows FINANCE_APPROVED", async () => expect((await resolveWorkflowQueueScope("OPS1", { ...request, statuses: ["FINANCE_APPROVED"] }, repository())).allowedStatuses).toEqual(["FINANCE_APPROVED"]));
  it("20. allows PENDING_OPERATIONS_REVIEW", async () => expect((await resolveWorkflowQueueScope("OPS1", { ...request, statuses: ["PENDING_OPERATIONS_REVIEW"] }, repository())).allowedStatuses).toEqual(["PENDING_OPERATIONS_REVIEW"]));
  it("21. rejects a status that tries to expand the queue", async () => expect((await resolveWorkflowQueueScope("OPS1", { ...request, statuses: ["WAREHOUSE_PREPARING"] }, repository())).code).toBe("MALFORMED_REQUEST"));
  it("22. denies an empty status plan", async () => expect((await resolveWorkflowQueueScope("OPS1", { ...request, statuses: [] }, repository())).code).toBe("NO_ALLOWED_STATUSES"));
  it("23. denies an empty area plan", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository({}, { areas: [] }))).queryPlan.denyAll).toBe(true));
  it("24. chunks areas deterministically", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository())).queryPlan.areaIdChunks).toEqual([["A1", "A2"]]));
  it("25. chunks statuses deterministically", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository())).queryPlan.workflowStatusChunks).toEqual([["FINANCE_APPROVED", "PENDING_OPERATIONS_REVIEW"]]));
  it("26. requires a bounded date range", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository())).queryPlan.dateRangeRequired).toBe(true));
  it("27. requires bounded pharmacy resolution for missing order geography", async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository())).queryPlan.requiresBoundedPharmacyResolution).toBe(true));
  for (const [number, role] of [[28, "Finance Officer"], [29, "Treasury Officer"], [30, "Warehouse Manager"], [31, "Delivery Officer"], [32, "Sales Manager"], [33, "Product Manager"], [34, "Medical Manager"]] as const) {
    it(`${number}. ${role} does not inherit the workflow policy`, async () => expect((await resolveWorkflowQueueScope("OPS1", request, repository({ role }))).code).toBe("UNSUPPORTED_ROLE"));
  }
  it("35. never falls back to GLOBAL", async () => expect(await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope: "GLOBAL" }))).toMatchObject({ authorized: false, code: "INVALID_CONFIGURED_GEOGRAPHY" }));
  it("36. contains no organizational subject mode", async () => expect(await resolveWorkflowQueueScope("OPS1", request, repository())).not.toHaveProperty("subjectMode"));
});

describe("WP5.2F.6B.2D.4 National-to-COUNTRY normalization", () => {
  it("41. maps National to the existing COUNTRY boundary", async () => {
    const result = await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope: "National" }));
    expect(result).toMatchObject({ authorized: true, configuredBoundary: { kind: "COUNTRY", countryIds: ["C-LIB"] } });
  });
  it("42. maps lowercase national to the existing COUNTRY boundary", async () => {
    expect((await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope: "national" }))).authorized).toBe(true);
  });
  it("43. maps uppercase NATIONAL to the existing COUNTRY boundary", async () => {
    expect((await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope: "NATIONAL" }))).authorized).toBe(true);
  });
  it("44. trims surrounding whitespace before scope normalization", async () => {
    expect((await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope: "  National  " }))).authorized).toBe(true);
  });
  it("45. preserves Country scope normalization across case variants", async () => {
    for (const securityScope of ["Country", "country", " COUNTRY "]) {
      expect((await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope }))).authorized, securityScope).toBe(true);
    }
  });
  it("46. continues to deny unknown scope values", async () => {
    expect((await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope: "Worldwide" }))).code).toBe("INVALID_CONFIGURED_GEOGRAPHY");
  });
  it("47. continues to deny a missing configured country", async () => {
    expect((await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope: "National", country: "" }))).code).toBe("MISSING_CONFIGURED_GEOGRAPHY");
  });
  it("48. continues to deny an invalid configured country", async () => {
    expect((await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope: "National", country: "Unknown" }))).code).toBe("INVALID_CONFIGURED_GEOGRAPHY");
  });
  it("49. continues to deny an inactive configured country", async () => {
    const result = await resolveWorkflowQueueScope("OPS1", request, repository(
      { securityScope: "National" },
      { countries: [{ id: "C-LIB", name: "Libya", active: false }] },
    ));
    expect(result.code).toBe("INVALID_CONFIGURED_GEOGRAPHY");
  });
  it("50. continues to deny a country without active canonical areas", async () => {
    const result = await resolveWorkflowQueueScope("OPS1", request, repository(
      { securityScope: "National" },
      { areas: [{ id: "A1", countryId: "C-LIB", districtId: "D1", cityId: "CT1", active: false }] },
    ));
    expect(result.code).toBe("NO_ACTIVE_AREAS");
  });
  it("51. requires no Territory assignments for National scope", async () => {
    const repo = repository({ securityScope: "National", areaIds: [] });
    expect(repo).not.toHaveProperty("getTerritoryAssignments");
    expect((await resolveWorkflowQueueScope("OPS1", request, repo)).authorized).toBe(true);
  });
  it("52. requires no Product assignments for National scope", async () => {
    const repo = repository({ securityScope: "National" });
    expect(repo).not.toHaveProperty("getProductAssignments");
    expect((await resolveWorkflowQueueScope("OPS1", request, repo)).authorized).toBe(true);
  });
  it("53. preserves exactly the two certified workflow statuses", async () => {
    const result = await resolveWorkflowQueueScope("OPS1", request, repository({ securityScope: "National" }));
    expect(result.allowedStatuses).toEqual(["FINANCE_APPROVED", "PENDING_OPERATIONS_REVIEW"]);
    expect(result.queryPlan.workflowStatusChunks).toEqual([["FINANCE_APPROVED", "PENDING_OPERATIONS_REVIEW"]]);
  });
});
