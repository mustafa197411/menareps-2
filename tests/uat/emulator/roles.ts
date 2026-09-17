import { createHash } from "node:crypto";
import { getValidManagerRoles } from "../../../src/lib/userPolicyEngine";
import { CANONICAL_USER_ROLES, Role } from "../../../src/types";

export type UatScopeMode = "ORGANIZATION" | "GEOGRAPHY" | "DESCENDANTS" | "PRODUCT_GEOGRAPHY" | "SELF";

export type UatIdentity = {
  uid: string;
  role: Role;
  managerId?: string;
  scopeMode: UatScopeMode;
  securityScope?: "National";
  countryId?: string;
  districtId?: string;
  cityId?: string;
  areaIds: string[];
  productIds: string[];
  primaryPromotionGroupId?: string;
  targetPromotionGroupIds?: string[];
};

export const UAT_IDENTITIES: readonly UatIdentity[] = [
  { uid: "uat-super-admin", role: Role.SUPER_ADMIN, scopeMode: "ORGANIZATION", areaIds: [], productIds: [] },
  { uid: "uat-admin", role: Role.ADMIN, managerId: "uat-super-admin", scopeMode: "ORGANIZATION", areaIds: [], productIds: [] },
  { uid: "uat-general-manager", role: Role.GENERAL_MANAGER, managerId: "uat-admin", scopeMode: "GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2", "EAST-A1"], productIds: [] },
  { uid: "uat-regional-manager-west", role: Role.REGIONAL_MANAGER, managerId: "uat-general-manager", scopeMode: "GEOGRAPHY", countryId: "LY", districtId: "WEST", areaIds: ["WEST-A1", "WEST-A2"], productIds: [] },
  { uid: "uat-country-manager-ly", role: Role.COUNTRY_MANAGER, managerId: "uat-regional-manager-west", scopeMode: "GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2", "EAST-A1"], productIds: [] },
  { uid: "uat-sales-marketing-manager", role: Role.SALES_MARKETING_MANAGER, managerId: "uat-country-manager-ly", scopeMode: "GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-sales-manager-west", role: Role.SALES_MANAGER, managerId: "uat-sales-marketing-manager", scopeMode: "GEOGRAPHY", countryId: "LY", districtId: "WEST", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-area-sales-manager", role: Role.AREA_SALES_MANAGER, managerId: "uat-sales-manager-west", scopeMode: "GEOGRAPHY", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-sales-supervisor", role: Role.SALES_SUPERVISOR, managerId: "uat-area-sales-manager", scopeMode: "DESCENDANTS", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-sales-rep-west-a", role: Role.SALES_REP, managerId: "uat-sales-supervisor", scopeMode: "SELF", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", areaIds: ["WEST-A1"], productIds: ["P-A"], primaryPromotionGroupId: "PG-A" },
  { uid: "uat-marketing-manager", role: Role.MARKETING_MANAGER, managerId: "uat-sales-marketing-manager", scopeMode: "PRODUCT_GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-product-manager", role: Role.PRODUCT_MANAGER, managerId: "uat-marketing-manager", scopeMode: "PRODUCT_GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1"], productIds: ["P-A", "P-B"] },
  { uid: "uat-marketing-officer", role: Role.MARKETING_OFFICER, managerId: "uat-marketing-manager", scopeMode: "PRODUCT_GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1"], productIds: ["P-A"] },
  { uid: "uat-medical-manager", role: Role.MEDICAL_MANAGER, managerId: "uat-country-manager-ly", scopeMode: "GEOGRAPHY", countryId: "LY", districtId: "WEST", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-medical-supervisor", role: Role.MEDICAL_SUPERVISOR, managerId: "uat-medical-manager", scopeMode: "DESCENDANTS", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-medical-rep-west-a", role: Role.MEDICAL_REP, managerId: "uat-medical-supervisor", scopeMode: "SELF", countryId: "LY", districtId: "WEST", cityId: "TRIPOLI", areaIds: ["WEST-A1"], productIds: ["P-A", "P-B"], primaryPromotionGroupId: "PG-A", targetPromotionGroupIds: ["PG-B"] },
  { uid: "uat-finance-manager", role: Role.FINANCE_MANAGER, managerId: "uat-general-manager", scopeMode: "GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2", "EAST-A1"], productIds: [] },
  { uid: "uat-finance-officer", role: Role.FINANCE, managerId: "uat-finance-manager", scopeMode: "GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2"], productIds: [] },
  { uid: "uat-treasury-officer", role: Role.TREASURY_OFFICER, managerId: "uat-finance-manager", scopeMode: "GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2"], productIds: [] },
  { uid: "uat-warehouse-manager", role: Role.WAREHOUSE_MANAGER, managerId: "uat-general-manager", scopeMode: "GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-inventory-officer", role: Role.INVENTORY_OFFICER, managerId: "uat-warehouse-manager", scopeMode: "GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-store-manager", role: Role.STORE_MANAGER, managerId: "uat-warehouse-manager", scopeMode: "GEOGRAPHY", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2"], productIds: ["P-A", "P-B"] },
  { uid: "uat-delivery-officer", role: Role.DELIVERY_OFFICER, managerId: "uat-store-manager", scopeMode: "SELF", countryId: "LY", areaIds: ["WEST-A1"], productIds: [] },
  { uid: "uat-order-operations-officer", role: Role.ORDER_OPS_OFFICER, managerId: "uat-country-manager-ly", scopeMode: "GEOGRAPHY", securityScope: "National", countryId: "LY", areaIds: ["WEST-A1", "WEST-A2"], productIds: [] },
] as const;

export function validateSyntheticManagerRelationships(
  identities: readonly UatIdentity[],
  activeUids: ReadonlySet<string> = new Set(identities.map((identity) => identity.uid)),
): void {
  const identitiesByUid = new Map(identities.map((identity) => [identity.uid, identity]));
  if (identitiesByUid.size !== identities.length) {
    throw new Error("[MENAREPS UAT] Synthetic identity UIDs must be unique.");
  }
  for (const identity of identities) {
    const allowedManagerRoles = getValidManagerRoles(identity.role);
    if (allowedManagerRoles.length === 0) continue;
    if (!identity.managerId) {
      throw new Error(`[MENAREPS UAT] Synthetic ${identity.role} requires a canonical managerId.`);
    }
    const manager = identitiesByUid.get(identity.managerId);
    if (!manager) {
      throw new Error(`[MENAREPS UAT] Synthetic manager ${identity.managerId} does not resolve to an identity.`);
    }
    if (!activeUids.has(manager.uid)) {
      throw new Error(`[MENAREPS UAT] Synthetic manager ${manager.uid} must be active.`);
    }
    if (!allowedManagerRoles.includes(manager.role)) {
      throw new Error(`[MENAREPS UAT] ${manager.role} is not an allowed manager role for ${identity.role}.`);
    }
  }
}

if (UAT_IDENTITIES.length !== 24 || new Set(UAT_IDENTITIES.map(item => item.role)).size !== 24 || CANONICAL_USER_ROLES.some(role => !UAT_IDENTITIES.some(item => item.role === role))) {
  throw new Error("[MENAREPS UAT] Synthetic identity matrix must cover exactly all 24 canonical roles.");
}
validateSyntheticManagerRelationships(UAT_IDENTITIES);

export function emulatorEmail(identity: UatIdentity): string {
  return `${identity.uid}@menareps-uat.test`;
}

export function emulatorPassword(identity: UatIdentity, runSecret = process.env.MENAREPS_UAT_RUN_SECRET): string {
  if (!runSecret || runSecret.length < 24) throw new Error("[MENAREPS UAT] Missing per-run emulator secret.");
  return `Uat!${createHash("sha256").update(`${runSecret}:${identity.uid}`).digest("hex").slice(0, 24)}`;
}
