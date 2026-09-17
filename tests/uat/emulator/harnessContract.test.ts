import { describe, expect, it } from "vitest";
import { GEOGRAPHY_FIXTURES } from "./fixtures";
import { UAT_IDENTITIES, validateSyntheticManagerRelationships } from "./roles";
import { syntheticProfile, territoryAssignmentsForIdentity } from "./seed";

describe("MENAREPS emulator harness contracts", () => {
  it("seeds every intended operational identity with canonical readiness fields", () => {
    for (const identity of UAT_IDENTITIES) {
      expect(syntheticProfile(identity)).toMatchObject({
        active: true,
        status: "Active",
        employmentStatus: "Active",
        loginAllowed: true,
        isDeleted: false,
      });
    }
  });

  it("derives territory assignments from complete canonical Area ancestry", () => {
    for (const identity of UAT_IDENTITIES) {
      const assignments = territoryAssignmentsForIdentity(identity);
      expect(assignments).toHaveLength(identity.areaIds.length);
      for (const assignment of assignments) {
        const area = GEOGRAPHY_FIXTURES.areas.find((candidate) => candidate.id === assignment.areaId);
        expect(area).toBeDefined();
        expect(assignment).toMatchObject({
          userId: identity.uid,
          countryId: area?.countryId,
          districtId: area?.districtId,
          cityId: area?.cityId,
          territoryId: area?.id,
          status: "Active",
          active: true,
        });
      }
    }
  });

  it("fails closed for invalid or mismatched synthetic geography", () => {
    const base = UAT_IDENTITIES.find((identity) => identity.areaIds.length > 0)!;
    expect(() => territoryAssignmentsForIdentity({ ...base, areaIds: ["UNKNOWN-AREA"] })).toThrow(/exactly one canonical fixture/);
    expect(() => territoryAssignmentsForIdentity({ ...base, countryId: "MISMATCH" })).toThrow(/invalid canonical geography ancestry/);
  });

  it("requires every managed operational identity to have one active manager with an allowed canonical role", () => {
    expect(() => validateSyntheticManagerRelationships(UAT_IDENTITIES)).not.toThrow();

    const adminIndex = UAT_IDENTITIES.findIndex((identity) => identity.role === "Admin");
    const superAdmin = UAT_IDENTITIES.find((identity) => identity.role === "Super Admin")!;
    const generalManager = UAT_IDENTITIES.find((identity) => identity.role === "General Manager")!;
    const replaceAdmin = (managerId?: string) => UAT_IDENTITIES.map((identity, index) => (
      index === adminIndex ? { ...identity, managerId } : identity
    ));

    expect(() => validateSyntheticManagerRelationships(replaceAdmin())).toThrow(/requires a canonical managerId/);
    expect(() => validateSyntheticManagerRelationships(replaceAdmin("unknown-manager"))).toThrow(/does not resolve/);
    expect(() => validateSyntheticManagerRelationships(UAT_IDENTITIES, new Set(UAT_IDENTITIES.map(({ uid }) => uid).filter((uid) => uid !== superAdmin.uid)))).toThrow(/must be active/);
    expect(() => validateSyntheticManagerRelationships(replaceAdmin(generalManager.uid))).toThrow(/not an allowed manager role/);
  });
});
