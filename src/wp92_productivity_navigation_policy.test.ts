import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Role, type Permissions, type User } from "./types";
import { canAccessGroup, canAccessView } from "./lib/userPolicyEngine";

const actor = (role: Role): User => ({
  id: `ACTOR-${role}`,
  uid: `ACTOR-${role}`,
  name: "Synthetic Actor",
  role,
} as User);

const permission = (view: boolean) => ({
  view,
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
} as Permissions);

describe("WP92 canonical Productivity navigation denial", () => {
  it("keeps an explicitly permitted Medical Representative workday reachable", () => {
    const user = actor(Role.MEDICAL_REP);
    expect(canAccessGroup(user, "productivity", permission(true))).toBe(true);
    expect(canAccessView(user, "productivity-workday", permission(true))).toBe(true);
  });

  it("lets an explicit denial override the same role and department defaults", () => {
    const user = actor(Role.MEDICAL_REP);
    expect(canAccessGroup(user, "productivity", permission(false))).toBe(false);
    expect(canAccessView(user, "productivity-workday", permission(false))).toBe(false);
  });

  it("does not grant an unrelated actor without canonical view permission", () => {
    const user = actor(Role.MARKETING_OFFICER);
    expect(canAccessGroup(user, "productivity", permission(false))).toBe(false);
    expect(canAccessView(user, "productivity-workday", permission(false))).toBe(false);
  });

  it("keeps parent and child visibility aligned for explicit allow and deny", () => {
    const user = actor(Role.MEDICAL_REP);
    for (const allowed of [true, false]) {
      expect(canAccessGroup(user, "productivity", permission(allowed)))
        .toBe(canAccessView(user, "productivity-workday", permission(allowed)));
    }
  });

  it("preserves the documented fallback only when no canonical record is supplied", () => {
    const user = actor(Role.MEDICAL_REP);
    expect(canAccessGroup(user, "productivity")).toBe(true);
    expect(canAccessView(user, "productivity-workday")).toBe(true);
  });

  it("changes presentation policy without modifying attendance backend authority", () => {
    const policy = readFileSync(new URL("./lib/userPolicyEngine.ts", import.meta.url), "utf8");
    const mutation = readFileSync(new URL("../server/attendanceMutationService.ts", import.meta.url), "utf8");
    expect(policy).not.toContain("executeAttendanceMutation");
    expect(mutation).toContain("executeAttendanceMutation");
    expect(mutation).toContain("db.runTransaction");
  });
});
