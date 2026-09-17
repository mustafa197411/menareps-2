import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Role, type Permissions, type User } from "./types";
import { canAccessCommercialOrderQueue, canAccessGroup, canAccessView, hasPermission } from "./lib/userPolicyEngine";

const user = (role: Role): User => ({ id: `synthetic-${role}`, name: "Synthetic", role, active: true, status: "Active" } as User);
const allowed = { view: true, create: false, edit: false, delete: false, approve: true, export: false, import: false, assign: false, reassign: false, viewTeamData: false, viewNationalData: false, viewFinancialData: true } as Permissions;
const denied = { ...allowed, view: false };

describe("WP103 canonical Finance order-queue navigation", () => {
  it("permits the parent and queue when canonical Orders review is visible", () => { const actor = user(Role.FINANCE); expect(canAccessCommercialOrderQueue(actor, allowed)).toBe(true); expect(canAccessGroup(actor, "sales-and-orders", allowed)).toBe(true); expect(canAccessView(actor, "sales-orders", allowed)).toBe(true); });
  it("explicit canonical denial hides both parent and queue", () => { const actor = user(Role.FINANCE); expect(canAccessGroup(actor, "sales-and-orders", denied)).toBe(false); expect(canAccessView(actor, "sales-orders", denied)).toBe(false); });
  it("Finance review visibility does not grant Order creation", () => { const actor = user(Role.FINANCE); expect(hasPermission(actor, "Orders", "create", allowed)).toBe(false); });
  it("unrelated Sales siblings remain inaccessible", () => { const actor = user(Role.FINANCE); for (const route of ["sales-offers", "payment-collection", "sales-stock-requests"]) expect(canAccessView(actor, route, allowed)).toBe(false); });
  it("backend transition and governed Pharmacy Visit creation remain authoritative", () => { const transition = fs.readFileSync(new URL("../server/commercialOrderTransitionService.ts", import.meta.url), "utf8"); const completion = fs.readFileSync(new URL("./features/pharmacyVisit/services/completePharmacyVisitV2.ts", import.meta.url), "utf8"); expect(transition).toContain("resolveOperationalScopeForActor"); expect(completion).toContain("completePharmacyVisitAuthoritatively"); expect(completion).not.toContain("runTransaction"); });
});
