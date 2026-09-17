import { describe, expect, it } from "vitest";
import { Role, type Permissions, type User } from "./types";
import {
  canAccessGroup,
  canAccessView,
} from "./lib/userPolicyEngine";
import { hasVisitMarketingRequestPermission } from "./lib/visitMarketingRequestPolicy";

const actor = (role: Role): User => ({
  id: `ACTOR-${role}`,
  uid: `ACTOR-${role}`,
  name: "Synthetic Actor",
  role,
} as User);

const permissions = (overrides: Record<string, unknown> = {}) => ({
  active: true,
  view: true,
  create: false,
  edit: false,
  delete: false,
  approve: false,
  reject: false,
  execute: false,
  export: false,
  import: false,
  assign: false,
  reassign: false,
  viewTeamData: false,
  viewNationalData: false,
  viewFinancialData: false,
  ...overrides,
} as Permissions);

describe("WP89 capability-aware Marketing group reachability", () => {
  it("lets an execution-capable higher manager reach the governed worklist", () => {
    const user = actor(Role.COUNTRY_MANAGER);
    const granted = permissions({ marketingRequestCapabilities: { execute: true } });
    expect(canAccessGroup(user, "marketing", granted)).toBe(true);
    expect(canAccessView(user, "marketing-my-requests", granted)).toBe(true);
  });

  it("keeps the Supervisor worklist reachable without exposing unrelated Marketing children", () => {
    const user = actor(Role.MEDICAL_SUPERVISOR);
    const granted = permissions({ marketingRequestCapabilities: { supervisorApprove: true, supervisorReject: true } });
    expect(canAccessGroup(user, "marketing", granted)).toBe(true);
    expect(canAccessView(user, "marketing-my-requests", granted)).toBe(true);
    for (const child of ["marketing-campaigns", "marketing-events", "marketing-settings", "marketing-materials-requests"]) {
      expect(canAccessView(user, child, granted)).toBe(false);
    }
  });

  it("does not turn creator worklist access into review or execution authority", () => {
    const user = actor(Role.MEDICAL_REP);
    const creator = permissions({ create: true, marketingRequestCapabilities: {} });
    expect(canAccessGroup(user, "marketing", creator)).toBe(true);
    expect(canAccessView(user, "marketing-my-requests", creator)).toBe(true);
    expect(hasVisitMarketingRequestPermission(user.role, "supervisorApprove", creator as never)).toBe(false);
    expect(hasVisitMarketingRequestPermission(user.role, "execute", creator as never)).toBe(false);
  });

  it("does not grant the Marketing group to an unrelated Sales actor without lifecycle capability", () => {
    const user = actor(Role.COUNTRY_MANAGER);
    const denied = permissions({
      marketingRequestCapabilities: {
        supervisorApprove: false,
        supervisorReject: false,
        finalApprove: false,
        finalReject: false,
        execute: false,
      },
    });
    expect(canAccessGroup(user, "marketing", denied)).toBe(false);
    expect(canAccessView(user, "marketing-my-requests", denied)).toBe(false);
  });

  it("keeps unrelated Marketing children independently denied for an execution-capable actor", () => {
    const user = actor(Role.COUNTRY_MANAGER);
    const granted = permissions({ marketingRequestCapabilities: { execute: true } });
    for (const child of ["marketing-campaigns", "marketing-events", "marketing-settings", "marketing-materials-requests"]) {
      expect(canAccessView(user, child, granted)).toBe(false);
    }
  });

  it("keeps backend request ancestry and scope outside the presentation predicate", () => {
    const user = actor(Role.COUNTRY_MANAGER);
    const granted = permissions({ marketingRequestCapabilities: { execute: true } });
    expect(canAccessGroup(user, "marketing", granted)).toBe(true);
    expect(Object.keys(granted)).not.toContain("activeAncestorUids");
    expect(Object.keys(granted)).not.toContain("requestAreaId");
  });
});
