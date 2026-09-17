import { normalizeRole, Role, type Permissions } from "../src/types";
import { OFFER_CAPABILITIES, OFFER_POLICY_ROLES, type OfferCapability } from "../src/features/offers/types";

const CREATOR_CAPABILITIES: readonly OfferCapability[] = [
  "offers.view", "offers.create", "offers.editDraft", "offers.submit", "offers.viewAudit",
];
const APPROVER_CAPABILITIES: readonly OfferCapability[] = [
  ...CREATOR_CAPABILITIES, "offers.approve", "offers.activate", "offers.pause", "offers.cancel",
];
const VISIT_CAPABILITIES: readonly OfferCapability[] = ["offers.applyDuringVisit"];

export function defaultOfferCapabilities(roleValue: string | null | undefined): Readonly<Record<OfferCapability, boolean>> {
  const role = normalizeRole(roleValue);
  const allowed = new Set<OfferCapability>(
    role === Role.SUPER_ADMIN || role === Role.ADMIN
      ? APPROVER_CAPABILITIES
      : role === Role.SALES_MARKETING_MANAGER || role === Role.SALES_MANAGER
        ? CREATOR_CAPABILITIES
        : role === Role.SALES_REP
          ? VISIT_CAPABILITIES
        : [],
  );
  if ((OFFER_POLICY_ROLES.approvers as readonly string[]).includes(role || "")) {
    allowed.add("offers.view");
    allowed.add("offers.approve");
  }
  return Object.freeze(Object.fromEntries(OFFER_CAPABILITIES.map(capability => [capability, allowed.has(capability)])) as Record<OfferCapability, boolean>);
}

/** Persisted overrides are restriction-only and cannot extend the role baseline. */
export function resolveOfferCapabilities(
  role: string | null | undefined,
  permissions?: Permissions | null,
): Readonly<Record<OfferCapability, boolean>> {
  const baseline = defaultOfferCapabilities(role);
  return Object.freeze(Object.fromEntries(OFFER_CAPABILITIES.map(capability => [
    capability,
    baseline[capability] === true && permissions?.offerCapabilities?.[capability] !== false,
  ])) as Record<OfferCapability, boolean>);
}

export function hasOfferCapability(
  role: string | null | undefined,
  permissions: Permissions | null | undefined,
  capability: OfferCapability,
): boolean {
  return resolveOfferCapabilities(role, permissions)[capability] === true;
}
