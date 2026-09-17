import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CANONICAL_USER_ROLES, Role, type Permissions, type User } from "../types";
import { APPLICATION_MODULES, APPLICATION_VIEW_FAMILIES } from "./canonicalRoleAccessBaseline";
import {
  canAccessCanonicalModule,
  canAccessCanonicalView,
  getCanonicalViewRegistration,
} from "./canonicalAccessControl";

const sidebarSource = fs.readFileSync("src/components/Sidebar.tsx", "utf8");
const sidebarRegistrySource = fs.readFileSync("src/lib/sidebarNavigationRegistry.ts", "utf8");
const routerSource = fs.readFileSync("src/components/SidebarPageRouter.tsx", "utf8");
const user = (role: Role): User => ({ id: `ROUTE-${role}`, name: role, email: "routes@example.invalid", role, active: true } as User);
const permission = (view: boolean): Permissions => ({
  view, create: true, edit: true, delete: false, approve: true, export: true, import: false,
  assign: false, reassign: false, viewTeamData: false, viewNationalData: false, viewFinancialData: false,
});
const unique = (values: Iterable<string>) => [...new Set(values)].sort();

function sidebarIdentifiers(): string[] {
  return unique([...`${sidebarSource}\n${sidebarRegistrySource}`.matchAll(/(?:\bid:\s*|\b(?:item|group)\()"([^"]+)"/g)].map(match => match[1]));
}

function routerIdentifiers(): string[] {
  return unique([
    ...[...routerSource.matchAll(/\bcase\s+"([^"]+)"/g)].map(match => match[1]),
    ...[...routerSource.matchAll(/\bactiveView\s*===\s*"([^"]+)"/g)].map(match => match[1]),
  ]);
}

describe("AP2O exhaustive production route registration", () => {
  it("registers every Sidebar module/view and every router route", () => {
    const identifiers = unique([...sidebarIdentifiers(), ...routerIdentifiers()]);
    const unregistered = identifiers.filter(identifier => getCanonicalViewRegistration(identifier).kind === "UNKNOWN");
    expect(unregistered).toEqual([]);
  });

  it("keeps every ordinary registered view mapped to one module", () => {
    const identifiers = unique([...sidebarIdentifiers(), ...routerIdentifiers()]);
    const invalid = identifiers.filter(identifier => {
      const registration = getCanonicalViewRegistration(identifier);
      if (registration.kind === "ALIAS" || registration.kind === "SHARED") return false;
      if (registration.kind === "INDEPENDENT") return !APPLICATION_MODULES.includes(registration.module);
      if (registration.kind === "MODULE") {
        const owners = APPLICATION_MODULES.filter(module => {
          if (identifier === module) return true;
          const family = APPLICATION_VIEW_FAMILIES[module];
          return family.exact.includes(identifier) || family.prefixes.some(prefix => identifier.startsWith(prefix));
        });
        return owners.length !== 1 || owners[0] !== registration.module;
      }
      return true;
    });
    expect(invalid).toEqual([]);
  });

  it("classifies recovered compatibility aliases explicitly", () => {
    expect(getCanonicalViewRegistration("physicians")).toEqual({ kind: "ALIAS", viewId: "physicians", canonicalViewId: "field-physician-list" });
    expect(getCanonicalViewRegistration("payment-collections")).toEqual({ kind: "ALIAS", viewId: "payment-collections", canonicalViewId: "payment-collection" });
    expect(getCanonicalViewRegistration("admin")).toEqual({ kind: "INDEPENDENT", viewId: "admin", module: "administration" });
    expect(getCanonicalViewRegistration("audit")).toEqual({ kind: "INDEPENDENT", viewId: "audit", module: "administration" });
  });

  it("never lets a true alias broaden its canonical destination", () => {
    for (const role of CANONICAL_USER_ROLES) {
      const context = { user: user(role), rolePermissions: permission(true) };
      expect(canAccessCanonicalView(context, "physicians")).toBe(canAccessCanonicalView(context, "field-physician-list"));
      expect(canAccessCanonicalView(context, "payment-collections")).toBe(canAccessCanonicalView(context, "payment-collection"));
    }
  });

  it("models visit review as shared Field/Pharmacy authority without widening Field access", () => {
    expect(getCanonicalViewRegistration("visits-review")).toEqual({
      kind: "SHARED", viewId: "visits-review", modules: ["field-operations", "pharmacies"],
    });
    expect(canAccessCanonicalView({ user: user(Role.MEDICAL_REP) }, "visits-review")).toBe(true);
    expect(canAccessCanonicalView({ user: user(Role.SALES_REP) }, "visits-review")).toBe(true);
    expect(canAccessCanonicalView({ user: user(Role.FINANCE) }, "visits-review")).toBe(false);
    expect(canAccessCanonicalView({ user: user(Role.SALES_REP) }, "field-physician-list")).toBe(false);
    expect(canAccessCanonicalView({ user: user(Role.SALES_REP) }, "visits")).toBe(true);
    expect(canAccessCanonicalView({ user: user(Role.SALES_REP) }, "field-visits-review")).toBe(true);
  });

  it("does not turn payment collection aliases into Sales financial access", () => {
    const sales = { user: user(Role.SALES_REP), rolePermissions: permission(true) };
    expect(canAccessCanonicalModule(sales, "sales-and-orders")).toBe(true);
    expect(canAccessCanonicalView(sales, "payment-collection")).toBe(false);
    expect(canAccessCanonicalView(sales, "payment-collections")).toBe(false);
    expect(canAccessCanonicalView(sales, "sales-orders")).toBe(true);
  });

  it("keeps parent metadata from authorizing mismatched children", () => {
    expect(getCanonicalViewRegistration("products-key-messages")).toEqual({ kind: "MODULE", viewId: "products-key-messages", module: "products" });
    expect(getCanonicalViewRegistration("admin-template-catalog")).toEqual({ kind: "MODULE", viewId: "admin-template-catalog", module: "administration" });
    expect(canAccessCanonicalModule({ user: user(Role.PRODUCT_MANAGER) }, "master-data")).toBe(true);
    expect(canAccessCanonicalView({ user: user(Role.PRODUCT_MANAGER) }, "admin-template-catalog")).toBe(false);
  });

  it("continues to fail closed for arbitrary routes", () => {
    expect(getCanonicalViewRegistration("new-unregistered-production-route").kind).toBe("UNKNOWN");
    expect(canAccessCanonicalView({ user: user(Role.SUPER_ADMIN) }, "new-unregistered-production-route")).toBe(false);
  });
});
