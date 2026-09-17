import { Role } from "../../../src/types";
import type { UatIdentity } from "./roles";

export const GEOGRAPHY_FIXTURES = {
  countries: [
    { id: "LY", name: "Libya", nameAr: "ليبيا", active: true },
    { id: "JO", name: "Jordan", nameAr: "الأردن", active: true },
  ],
  districts: [
    { id: "WEST", countryId: "LY", name: "West", active: true },
    { id: "EAST", countryId: "LY", name: "East", active: true },
    { id: "JO-CENTRAL", countryId: "JO", name: "Central", active: true },
  ],
  cities: [
    { id: "TRIPOLI", countryId: "LY", districtId: "WEST", name: "Tripoli", active: true },
    { id: "MISRATA", countryId: "LY", districtId: "WEST", name: "Misrata", active: true },
    { id: "BENGHAZI", countryId: "LY", districtId: "EAST", name: "Benghazi", active: true },
    { id: "AMMAN", countryId: "JO", districtId: "JO-CENTRAL", name: "Amman", active: true },
  ],
  areas: [
    { id: "WEST-A1", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", name: "UAT Area 1", active: true },
    { id: "WEST-A2", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", name: "UAT Area 2", active: true },
    { id: "WEST-M1", countryId: "LY", districtId: "WEST", cityId: "MISRATA", name: "UAT Area 1", active: true },
    { id: "EAST-A1", countryId: "LY", districtId: "EAST", cityId: "BENGHAZI", name: "UAT Area 1", active: true },
    { id: "JO-A1", countryId: "JO", districtId: "JO-CENTRAL", cityId: "AMMAN", name: "UAT Area 1", active: true },
  ],
} as const;

export const PRODUCT_FIXTURES = [
  { id: "P-A", name: "Synthetic Product A", promotionGroupId: "PG-A", marketId: "LY", price: 7, active: true },
  { id: "P-B", name: "Synthetic Product B", promotionGroupId: "PG-B", marketId: "LY", price: 11, active: true },
  { id: "P-OUTSIDE", name: "Synthetic Outside Product", promotionGroupId: "PG-OUTSIDE", marketId: "JO", price: 13, active: true },
] as const;

export const GOVERNED_MODULES = [
  "FIELD_OPERATIONS", "PHARMACIES", "PHYSICIANS", "VISITS", "TEAM_ACTIVITY",
  "REPORTS", "ANALYTICS", "ADMINISTRATION", "ORDERS",
] as const;

const ADMIN_ROLES = new Set<Role>([Role.SUPER_ADMIN, Role.ADMIN]);

export function navigationForRole(role: Role) {
  return GOVERNED_MODULES.map(module => ({
    module,
    visible: module === "ADMINISTRATION"
      ? ADMIN_ROLES.has(role)
      : module === "TEAM_ACTIVITY"
        ? true
        : module === "FIELD_OPERATIONS"
          ? [Role.GENERAL_MANAGER, Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER, Role.SALES_MARKETING_MANAGER, Role.MARKETING_MANAGER, Role.PRODUCT_MANAGER, Role.MEDICAL_SUPERVISOR, Role.MEDICAL_REP].includes(role)
          : module === "PHARMACIES"
            ? [Role.GENERAL_MANAGER, Role.REGIONAL_MANAGER, Role.COUNTRY_MANAGER, Role.SALES_MARKETING_MANAGER, Role.MARKETING_MANAGER, Role.PRODUCT_MANAGER, Role.MEDICAL_SUPERVISOR, Role.SALES_REP].includes(role)
            : ADMIN_ROLES.has(role),
  }));
}

export function rolePermissionFixture(identity: UatIdentity) {
  const admin = ADMIN_ROLES.has(identity.role);
  const supervisorReview = identity.role === Role.MEDICAL_SUPERVISOR;
  const medicalGovernance = identity.role === Role.MEDICAL_MANAGER || identity.role === Role.COUNTRY_MANAGER;
  return {
    role: identity.role,
    active: true,
    view: true,
    create: admin || [Role.MEDICAL_REP, Role.SALES_REP].includes(identity.role),
    edit: admin,
    delete: admin,
    export: admin || identity.role === Role.GENERAL_MANAGER,
    approve: admin || /Manager|Supervisor|Officer/.test(identity.role),
    reject: admin || /Manager|Supervisor|Officer/.test(identity.role),
    return: admin || /Manager|Supervisor|Officer/.test(identity.role),
    import: admin,
    assign: admin || /Manager/.test(identity.role),
    marketingRequestCapabilities: {
      supervisorApprove: supervisorReview,
      supervisorReject: supervisorReview,
      finalApprove: admin || medicalGovernance,
      finalReject: admin || medicalGovernance,
      execute: identity.role === Role.SALES_MARKETING_MANAGER,
    },
    resourceCapabilities: { manage: admin || [Role.SALES_MARKETING_MANAGER, Role.MARKETING_MANAGER, Role.PRODUCT_MANAGER, Role.MARKETING_OFFICER].includes(identity.role) },
    sidebarVisibility: navigationForRole(identity.role).filter(item => item.visible).map(item => item.module),
  };
}

export function accessGovernanceFixture(identity: UatIdentity) {
  return {
    role: identity.role,
    active: true,
    dataScopeMode: identity.scopeMode,
    navigation: navigationForRole(identity.role),
    capabilities: GOVERNED_MODULES.map(module => ({
      module,
      actions: { view: navigationForRole(identity.role).find(item => item.module === module)?.visible === true },
    })),
  };
}
