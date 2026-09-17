import { describe, expect, it } from "vitest";
import { OFFER_CAPABILITIES, OFFER_POLICY_ROLES } from "../src/features/offers/types";
import { Role } from "../src/types";
import { getValidManagerRoles } from "../src/lib/userPolicyEngine";
import { isApprovedOfferApproverRole } from "../src/features/offers/offerPolicy";
import { defaultOfferCapabilities, resolveOfferCapabilities } from "./offerAuthorization";

describe("Offer restriction-only authorization", () => {
  it("derives the canonical role matrix from the existing registry", () => {
    for (const role of OFFER_POLICY_ROLES.approvers) expect(defaultOfferCapabilities(role)).toMatchObject({ "offers.view": true, "offers.approve": true });
    for (const role of OFFER_POLICY_ROLES.creators.filter(role => !(OFFER_POLICY_ROLES.approvers as readonly string[]).includes(role))) expect(defaultOfferCapabilities(role)).toMatchObject({ "offers.view": true, "offers.create": true, "offers.submit": true, "offers.approve": false, "offers.activate": false });
    for (const role of OFFER_POLICY_ROLES.visitUsers) expect(defaultOfferCapabilities(role)).toMatchObject({ "offers.view": false, "offers.create": false, "offers.applyDuringVisit": true });
  });

  it("allows false to restrict but never allows true to extend a baseline", () => {
    expect(resolveOfferCapabilities("Admin", { offerCapabilities: { "offers.create": false } } as never)["offers.create"]).toBe(false);
    expect(resolveOfferCapabilities("Sales Manager", { offerCapabilities: { "offers.approve": true } } as never)["offers.approve"]).toBe(false);
    expect(resolveOfferCapabilities("Sales Representative", { offerCapabilities: { "offers.view": true } } as never)["offers.view"]).toBe(false);
    expect(resolveOfferCapabilities("Finance Officer", { offerCapabilities: Object.fromEntries(OFFER_CAPABILITIES.map(capability => [capability, true])) } as never)["offers.create"]).toBe(false);
  });
});

describe("canonical ancestor minimum approval capabilities", () => {
  const newlyEligible = [Role.SALES_MARKETING_MANAGER, Role.COUNTRY_MANAGER, Role.REGIONAL_MANAGER, Role.GENERAL_MANAGER];
  it("shared approvers exactly match the canonical transitive ancestors of Sales Manager", () => {
    const ancestors = new Set<Role>();
    const queue = [...getValidManagerRoles(Role.SALES_MANAGER)];
    while (queue.length) {
      const role = queue.shift()!;
      if (ancestors.has(role)) continue;
      ancestors.add(role);
      queue.push(...getValidManagerRoles(role));
    }
    expect([...ancestors].sort()).toEqual([...OFFER_POLICY_ROLES.approvers].sort());
    for (const role of Object.values(Role)) {
      expect(defaultOfferCapabilities(role)["offers.approve"]).toBe(ancestors.has(role));
      expect(isApprovedOfferApproverRole(role)).toBe(ancestors.has(role));
    }
  });
  it.each(newlyEligible)("grants only the intended minimum additions to %s", role => {
    const granted = OFFER_CAPABILITIES.filter(capability => defaultOfferCapabilities(role)[capability]);
    const expected = role === Role.SALES_MARKETING_MANAGER
      ? ["offers.view", "offers.create", "offers.editDraft", "offers.submit", "offers.viewAudit", "offers.approve"]
      : ["offers.view", "offers.approve"];
    expect([...granted].sort()).toEqual(expected.sort());
    for (const capability of ["offers.view", "offers.approve"] as const) {
      expect(resolveOfferCapabilities(role, { offerCapabilities: { [capability]: false } } as never)[capability]).toBe(false);
    }
  });
  it.each([Role.ADMIN, Role.SUPER_ADMIN])("preserves all existing administration capabilities for %s", role => {
    expect(OFFER_CAPABILITIES.filter(capability => defaultOfferCapabilities(role)[capability]).sort()).toEqual([
      "offers.view", "offers.create", "offers.editDraft", "offers.submit", "offers.viewAudit", "offers.approve", "offers.activate", "offers.pause", "offers.cancel",
    ].sort());
  });
});
