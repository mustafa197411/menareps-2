import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pharmacy } from "./types";
import type { EffectiveOperationalScope } from "../server/operationalScopeService";

const { resolveOperationalScopeForActor } = vi.hoisted(() => ({
  resolveOperationalScopeForActor: vi.fn(),
}));

vi.mock("../server/operationalScopeRepository", () => ({
  createFirestoreOperationalScopeRepository: vi.fn(() => ({})),
  resolveOperationalScopeForActor,
}));

import {
  resolveScopedPharmacyRead,
  type PharmacyReadRepository,
} from "../server/pharmacyReadService";

const salesScope: EffectiveOperationalScope = {
  authorized: true,
  actorUid: "usr-sales-100",
  role: "Sales Representative",
  boundaryKind: "AREA",
  subjectMode: "SELF",
  subjectUids: ["usr-sales-100"],
  countryIds: ["C-LIB-8842"],
  regionIds: ["R-WEST"],
  districtIds: ["R-WEST"],
  cityIds: ["CT-TRIPOLI-EAST"],
  areaIds: ["LY-WEST-TRE2"],
  productIds: ["prod-1"],
  productGroupIds: ["pg-01"],
  queryPlan: {
    denyAll: false,
    areaIdChunks: [["LY-WEST-TRE2"]],
    subjectUidChunks: [["usr-sales-100"]],
    productIdChunks: [["prod-1"]],
    requiresPostFilter: true,
  },
  diagnostics: {
    excludedAssignmentIds: [],
    malformedAssignmentIds: [],
    outsideBoundaryAssignmentIds: [],
  },
};

const record = (
  id: string,
  areaId: string,
  assignedRepId: string,
  overrides: Partial<Pharmacy> & { isDeleted?: boolean } = {},
): Pharmacy => ({
  id,
  name: id,
  territory: areaId,
  region: "R-WEST",
  outstandingBalance: 0,
  address: "Test address",
  type: "Retail",
  active: true,
  status: "Active",
  areaId,
  assignedRepId,
  ...overrides,
} as Pharmacy);

const recordA = record("PHM-A", "LY-WEST-TRE2", "usr-sales-100");
const recordB = record("PHM-B", "LY-WEST-TRE2", "usr-sales-999");
const recordC = record("PHM-C", "LY-WEST-TRW5", "usr-sales-100");
const recordD = record("PHM-D", "LY-WEST-TRE2", "usr-sales-100", { isDeleted: true } as Partial<Pharmacy>);
const recordE = record("PHM-E", "LY-WEST-TRE2", "usr-sales-100", { active: false, status: "Inactive" });
const allRecords = [recordA, recordB, recordC, recordD, recordE];

function boundedRepository(records: Pharmacy[]): PharmacyReadRepository {
  return {
    queryByAreaIds: vi.fn(async (areaIds) => records.filter((item) => areaIds.includes(item.areaId || ""))),
  };
}

beforeEach(() => {
  resolveOperationalScopeForActor.mockReset();
  resolveOperationalScopeForActor.mockResolvedValue(salesScope);
});

describe("WP5.2D.1 pharmacy security requirements migrated to canonical READ", () => {
  it("Test A: Sales Rep sees active pharmacy when canonical Area matches", async () => {
    const result = await resolveScopedPharmacyRead("usr-sales-100", {
      pharmacyReadRepository: boundedRepository(allRecords),
      canReadDirectory: () => true,
    });
    expect(result.pharmacies.map((item) => item.id)).toContain("PHM-A");
  });

  it("Test B: Sales Rep sees same-area pharmacy assigned to another representative because directory READ is area-based", async () => {
    const result = await resolveScopedPharmacyRead("usr-sales-100", {
      pharmacyReadRepository: boundedRepository(allRecords),
      canReadDirectory: () => true,
    });
    expect(result.pharmacies.map((item) => item.id)).toContain("PHM-B");
  });

  it("Test C: out-of-area pharmacy remains denied even when assignedRepId matches", async () => {
    const repository = boundedRepository(allRecords);
    const result = await resolveScopedPharmacyRead("usr-sales-100", {
      pharmacyReadRepository: repository,
      canReadDirectory: () => true,
    });
    expect(result.pharmacies.map((item) => item.id)).not.toContain("PHM-C");
    expect(repository.queryByAreaIds).toHaveBeenCalledWith(["LY-WEST-TRE2"]);
  });

  it("Test D: deleted pharmacy remains denied", async () => {
    const result = await resolveScopedPharmacyRead("usr-sales-100", {
      pharmacyReadRepository: boundedRepository(allRecords),
      canReadDirectory: () => true,
    });
    expect(result.pharmacies.map((item) => item.id)).not.toContain("PHM-D");
  });

  it("Test E: inactive pharmacy remains denied", async () => {
    const result = await resolveScopedPharmacyRead("usr-sales-100", {
      pharmacyReadRepository: boundedRepository(allRecords),
      canReadDirectory: () => true,
    });
    expect(result.pharmacies.map((item) => item.id)).not.toContain("PHM-E");
  });

  it("Test F: Medical Representative remains denied by pharmacy feature policy", async () => {
    resolveOperationalScopeForActor.mockResolvedValue({
      ...salesScope,
      actorUid: "usr-med-200",
      role: "Medical Representative",
      subjectUids: ["usr-med-200"],
      queryPlan: {
        ...salesScope.queryPlan,
        subjectUidChunks: [["usr-med-200"]],
      },
    });
    const repository = boundedRepository(allRecords);
    const result = await resolveScopedPharmacyRead("usr-med-200", {
      pharmacyReadRepository: repository,
      canReadDirectory: () => false,
    });
    expect(result).toEqual({
      authorized: false,
      code: "PHARMACY_DIRECTORY_ACCESS_DENIED",
      pharmacies: [],
    });
    expect(repository.queryByAreaIds).not.toHaveBeenCalled();
  });

  it("Test G: Super Admin sees active non-deleted pharmacies only inside explicit canonical GLOBAL geography", async () => {
    resolveOperationalScopeForActor.mockResolvedValue({
      ...salesScope,
      actorUid: "ADMIN",
      role: "Super Admin",
      boundaryKind: "GLOBAL",
      subjectMode: "HIERARCHY",
      subjectUids: ["ADMIN", "usr-sales-100", "usr-sales-999"],
      areaIds: ["LY-WEST-TRE2", "LY-WEST-TRW5"],
      queryPlan: {
        ...salesScope.queryPlan,
        areaIdChunks: [["LY-WEST-TRE2", "LY-WEST-TRW5"]],
        subjectUidChunks: [["ADMIN", "usr-sales-100", "usr-sales-999"]],
      },
    });
    const result = await resolveScopedPharmacyRead("ADMIN", {
      pharmacyReadRepository: boundedRepository(allRecords),
      canReadDirectory: () => true,
    });
    expect(result.pharmacies.map((item) => item.id)).toEqual(["PHM-A", "PHM-B", "PHM-C"]);
  });
});
