import { describe, expect, it } from "vitest";
import { Role, type Permissions, type User } from "./types";
import {
  canAccessView,
  canAccessVisitMarketingRequestWorklist,
} from "./lib/userPolicyEngine";
import { hasVisitMarketingRequestPermission } from "./lib/visitMarketingRequestPolicy";

const user = (role: Role): User => ({ id: `ACTOR-${role}`, uid: `ACTOR-${role}`, name: "Synthetic Actor", role } as User);
const permissions = (overrides: Record<string, unknown> = {}) => ({
  view: true,
  create: false,
  edit: false,
  delete: false,
  approve: false,
  export: false,
  import: false,
  assign: false,
  reassign: false,
  viewTeamData: false,
  viewNationalData: false,
  viewFinancialData: false,
  ...overrides,
} as Permissions);

describe("WP87 Visit Marketing Request worklist route policy", () => {
  it("allows an applicable Supervisor presentation capability to reach only the governed worklist", () => {
    const actor = user(Role.MEDICAL_SUPERVISOR);
    const granted = permissions({
      approve: true,
      marketingRequestCapabilities: { supervisorApprove: true, supervisorReject: true },
    });
    expect(canAccessVisitMarketingRequestWorklist(actor, granted)).toBe(true);
    expect(canAccessView(actor, "marketing-my-requests", granted)).toBe(true);
    for (const unrelated of ["marketing-campaigns", "marketing-events", "marketing-settings", "marketing-materials-requests"]) {
      expect(canAccessView(actor, unrelated, granted)).toBe(false);
    }
  });

  it("does not turn Medical Representative worklist access into Supervisor review capability", () => {
    const actor = user(Role.MEDICAL_REP);
    const creator = permissions({ create: true, marketingRequestCapabilities: {} });
    expect(canAccessView(actor, "marketing-my-requests", creator)).toBe(true);
    expect(hasVisitMarketingRequestPermission(actor.role, "supervisorApprove", creator as any)).toBe(false);
    expect(hasVisitMarketingRequestPermission(actor.role, "supervisorReject", creator as any)).toBe(false);
  });

  it("denies unrelated Medical actors when canonical worklist capabilities are explicitly absent", () => {
    const actor = user(Role.MEDICAL_SUPERVISOR);
    const denied = permissions({
      approve: true,
      marketingRequestCapabilities: {
        supervisorApprove: false,
        supervisorReject: false,
        finalApprove: false,
        finalReject: false,
        execute: false,
      },
    });
    expect(canAccessView(actor, "marketing-my-requests", denied)).toBe(false);
  });

  it("keeps backend authorization distinct from presentational route visibility", () => {
    const actor = user(Role.MEDICAL_SUPERVISOR);
    const granted = permissions({ marketingRequestCapabilities: { supervisorApprove: true, supervisorReject: true } });
    expect(canAccessView(actor, "marketing-my-requests", granted)).toBe(true);
    expect(hasVisitMarketingRequestPermission(actor.role, "supervisorApprove", granted as any)).toBe(true);
    // Request supervisor identity, hierarchy, and Area scope are intentionally
    // unavailable to this UI predicate and remain backend-only decisions.
    expect(Object.keys(granted)).not.toContain("supervisorUid");
    expect(Object.keys(granted)).not.toContain("areaId");
  });
});
