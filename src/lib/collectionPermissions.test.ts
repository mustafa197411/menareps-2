import { describe, it, expect } from "vitest";
import { Role, type Permissions, type User } from "../types";
import { CRM_MODULE_PERMISSIONS, hasPermission } from "./userPolicyEngine";
import { permitsCollection } from "./collectionPermissions";
describe("collection baseline and restrictive overrides", () => {
  it("allows the Sales Representative baseline", () => expect(permitsCollection(Role.SALES_REP, "create")).toBe(true));
  it("denies Delivery baseline", () => expect(permitsCollection(Role.DELIVERY_OFFICER, "create")).toBe(false));
  it("respects restriction", () => expect(permitsCollection(Role.SALES_REP, "create", { create: false })).toBe(false));
  it("cannot elevate baseline denial", () => expect(permitsCollection(Role.DELIVERY_OFFICER, "create", { create: true })).toBe(false));
  it("does not bypass restrictions for administrators", () => expect(permitsCollection(Role.SUPER_ADMIN, "approve", { approve: false })).toBe(false));
  it("does not grant rep verification", () => expect(permitsCollection(Role.SALES_REP, "approve", { approve: true })).toBe(false));
});

describe("Collections.reverse canonical contract", () => {
  const grants = new Set([Role.FINANCE_MANAGER, Role.TREASURY_OFFICER]);
  for (const role of Object.values(Role)) {
    for (const reverse of [undefined, false, true]) {
      it(`${role}: reverse override ${String(reverse)} agrees across entry points`, () => {
        const restrictions = reverse === undefined ? {} : { reverse };
        const expected = grants.has(role) && reverse !== false;
        expect(CRM_MODULE_PERMISSIONS[role]?.Collections?.reverse === true).toBe(grants.has(role));
        expect(hasPermission({ role } as User, "Collections", "reverse", restrictions as Permissions)).toBe(expected);
        expect(permitsCollection(role, "reverse", restrictions)).toBe(expected);
      });
    }
  }
  it.each([Role.FINANCE_MANAGER, Role.TREASURY_OFFICER])("respects inactive restriction for %s in both entry points", role => {
    const restrictions = { active: false, reverse: true };
    expect(hasPermission({ role } as User, "Collections", "reverse", restrictions as unknown as Permissions)).toBe(false);
    expect(permitsCollection(role, "reverse", restrictions)).toBe(false);
  });
  it("reject permission does not confer posted-payment reversal", () => {
    expect(hasPermission({ role: Role.FINANCE } as User, "Collections", "reject")).toBe(true);
    expect(permitsCollection(Role.FINANCE, "reject")).toBe(true);
    expect(hasPermission({ role: Role.FINANCE } as User, "Collections", "reverse")).toBe(false);
    expect(permitsCollection(Role.FINANCE, "reverse", { reject: true })).toBe(false);
  });
  it.each([Role.SUPER_ADMIN, Role.SYSTEM_ADMINISTRATOR])("preserves unrelated administrator bypass for %s", role => {
    expect(hasPermission({ role } as User, "Orders", "create", { create: false } as Permissions)).toBe(true);
    expect(hasPermission({ role } as User, "Collections", "reject", { approve: false } as Permissions)).toBe(true);
  });
});
