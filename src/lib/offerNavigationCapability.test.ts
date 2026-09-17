import { describe, expect, it } from "vitest";
import { Role, type Permissions, type User } from "../types";
import { canAccessCanonicalView } from "./canonicalAccessControl";

const user = (role: Role): User => ({ id: `SYNTHETIC_USER_${role.replace(/\W/g, "_")}`, name: "Synthetic User", role, active: true } as User);

describe("Offers navigation capability integration", () => {
  it.each([
    [Role.ADMIN, true],
    [Role.SALES_MANAGER, true],
    [Role.SALES_REP, false],
    [Role.FINANCE, false],
  ] as const)("uses canonical offers.view capability for %s", (role, expected) => {
    expect(canAccessCanonicalView({ user: user(role) }, "sales-offers")).toBe(expected);
  });

  it("honors restriction-only persisted Offer capability denial", () => {
    const permissions = { offerCapabilities: { "offers.view": false } } as Permissions;
    expect(canAccessCanonicalView({ user: user(Role.ADMIN), rolePermissions: permissions }, "sales-offers")).toBe(false);
  });
});
