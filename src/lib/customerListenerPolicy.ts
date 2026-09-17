import { normalizeRole, Role } from "../types";

export type CustomerQueryShape =
  | { kind: "none"; reason: string }
  | { kind: "collection" }
  | { kind: "area"; operator: "==" | "in"; value: string | string[] };

export function getPhysicianQueryShape(role: Role | string, resolvedAreaIds: string[]): CustomerQueryShape {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === Role.MEDICAL_MANAGER || normalizedRole === Role.MEDICAL_REP || normalizedRole === Role.SALES_REP) {
    const areaIds = Array.from(new Set(resolvedAreaIds.filter(Boolean))).sort().slice(0, 30);
    if (areaIds.length === 0) return { kind: "none", reason: "NO_AUTHORIZED_AREAS" };
    return areaIds.length === 1
      ? { kind: "area", operator: "==", value: areaIds[0] }
      : { kind: "area", operator: "in", value: areaIds };
  }
  return { kind: "collection" };
}

export function getPharmacyQueryShape(role: Role | string, resolvedAreaIds: string[]): CustomerQueryShape {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === Role.MEDICAL_MANAGER || normalizedRole === Role.MEDICAL_REP) {
    return { kind: "none", reason: "MEDICAL_ROLE_NO_PHARMACY_SUBSCRIPTION" };
  }
  if (normalizedRole === Role.SALES_REP) {
    const areaIds = Array.from(new Set(resolvedAreaIds.filter(Boolean))).sort().slice(0, 30);
    if (areaIds.length === 0) return { kind: "none", reason: "NO_AUTHORIZED_AREAS" };
    return areaIds.length === 1
      ? { kind: "area", operator: "==", value: areaIds[0] }
      : { kind: "area", operator: "in", value: areaIds };
  }
  return { kind: "collection" };
}

export function shouldCommitAuthorizedSnapshot(fromCache: boolean): boolean {
  return !fromCache;
}
