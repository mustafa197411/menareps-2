import { describe, expect, it } from "vitest";
import { Role } from "./types";
import { resolveCanonicalAreaIds } from "./lib/securityEngine";
import { getPharmacyQueryShape, getPhysicianQueryShape, shouldCommitAuthorizedSnapshot } from "./lib/customerListenerPolicy";

describe("Medical Manager customer listener authorization", () => {
  it("uses the shared canonical geographic scope", () => {
    const manager = { id: "mmgr", role: Role.MEDICAL_MANAGER, areaIds: ["area-profile"] } as any;
    expect(resolveCanonicalAreaIds(manager, [
      { id: "ta-1", userId: "mmgr", territoryId: "area-assigned", status: "Active" },
      { id: "ta-2", userId: "other", territoryId: "area-other", status: "Active" },
    ] as any)).toEqual(["area-assigned", "area-profile"]);
  });

  it("queries physicians by area and never as an unrestricted collection", () => {
    expect(getPhysicianQueryShape(Role.MEDICAL_MANAGER, ["area-b", "area-a"])).toEqual({ kind: "area", operator: "in", value: ["area-a", "area-b"] });
    expect(getPhysicianQueryShape(Role.MEDICAL_MANAGER, [])).toEqual({ kind: "none", reason: "NO_AUTHORIZED_AREAS" });
  });

  it("does not subscribe a Medical Manager to pharmacies", () => {
    expect(getPharmacyQueryShape(Role.MEDICAL_MANAGER, ["area-a"])).toEqual({ kind: "none", reason: "MEDICAL_ROLE_NO_PHARMACY_SUBSCRIPTION" });
  });

  it("prevents cached cross-role customer data from entering state", () => {
    expect(shouldCommitAuthorizedSnapshot(true)).toBe(false);
    expect(shouldCommitAuthorizedSnapshot(false)).toBe(true);
  });
});
