import { Role, normalizeRole, type User } from "../types";
import { getValidManagerRoles } from "./userPolicyEngine";

export interface ImportedUserRowInput {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: Role;
  managerEmail: string;
  country: string;
  district: string;
  city: string;
  areaIds: string[];
  areaNames: string[];
}

export interface ImportedUserRowResult {
  email: string;
  authUid?: string;
  usersDocumentId?: string;
  activationProfileId?: string;
  managerId?: string;
  territoryAssignmentCount: number;
  productAssignmentCount: number;
  readiness: "Awaiting Operational Assignment" | "Operational";
  status: "CREATED" | "UPDATED" | "PARTIAL" | "FAILED";
  resourceIds: Array<{ id: string; collection: string; operation: "CREATED" | "UPDATED" }>;
  error?: string;
}

export function resolveCanonicalImportManager(
  managerEmail: string,
  importedRole: Role,
  users: User[],
): { managerId: string; managerEmail: string } {
  const normalizedEmail = managerEmail.trim().toLowerCase();
  const matches = users.filter((user) => user.email?.trim().toLowerCase() === normalizedEmail && user.isDeleted !== true);
  if (matches.length === 0) throw new Error(`Manager '${normalizedEmail}' was not found.`);
  if (matches.length > 1) throw new Error(`Manager '${normalizedEmail}' is ambiguous.`);
  const manager = matches[0];
  if (!manager.id || manager.active === false || manager.loginAllowed === false) throw new Error(`Manager '${normalizedEmail}' is not operational.`);
  if (!getValidManagerRoles(importedRole).includes(normalizeRole(manager.role) as Role)) {
    throw new Error(`Manager '${normalizedEmail}' has invalid role '${manager.role}' for '${importedRole}'.`);
  }
  return { managerId: manager.id, managerEmail: normalizedEmail };
}

export interface ImportedUserOnboardingDependencies {
  provisionAuth(input: { email: string; name: string; role: Role }): Promise<{ success: boolean; authUid: string; existing: boolean }>;
  persistCanonical(input: ImportedUserRowInput & { authUid: string; managerId: string; managerEmail: string }): Promise<void>;
  syncTerritories(input: { authUid: string; role: Role; areaIds: string[] }): Promise<string[]>;
  verify(input: { authUid: string; email: string; managerId: string; areaIds: string[]; territoryAssignmentIds: string[] }): Promise<void>;
}

export async function onboardImportedUser(
  row: ImportedUserRowInput,
  managers: User[],
  dependencies: ImportedUserOnboardingDependencies,
  existingCanonicalUserId?: string,
): Promise<ImportedUserRowResult> {
  const readiness = "Awaiting Operational Assignment" as const;
  let provisionedUid = "";
  try {
    const manager = resolveCanonicalImportManager(row.managerEmail, row.role, managers);
    const provisioned = await dependencies.provisionAuth({ email: row.email, name: `${row.firstName} ${row.lastName}`.trim() || row.username, role: row.role });
    if (!provisioned.success || !provisioned.authUid) throw new Error("Firebase Auth provisioning did not return a canonical UID.");
    provisionedUid = provisioned.authUid;
    if (existingCanonicalUserId && existingCanonicalUserId !== provisioned.authUid) throw new Error("Identity conflict: existing users document does not match Firebase Auth UID.");
    await dependencies.persistCanonical({ ...row, authUid: provisioned.authUid, ...manager });
    const territoryIds = await dependencies.syncTerritories({ authUid: provisioned.authUid, role: row.role, areaIds: row.areaIds });
    await dependencies.verify({ authUid: provisioned.authUid, email: row.email, managerId: manager.managerId, areaIds: row.areaIds, territoryAssignmentIds: territoryIds });
    // Auth may pre-exist while the operational profile does not. Firestore resource
    // operation is therefore based on canonical users/{uid}, not Auth creation.
    const operation = existingCanonicalUserId ? "UPDATED" : "CREATED";
    return {
      email: row.email, authUid: provisioned.authUid, usersDocumentId: provisioned.authUid,
      activationProfileId: provisioned.authUid, managerId: manager.managerId,
      territoryAssignmentCount: territoryIds.length, productAssignmentCount: 0, readiness,
      status: operation,
      resourceIds: [
        { id: provisioned.authUid, collection: "users", operation },
        { id: provisioned.authUid, collection: "userActivationProfiles", operation },
        ...territoryIds.map((id) => ({ id, collection: "userTerritoryAssignments", operation } as const)),
      ],
    };
  } catch (error: any) {
    return { email: row.email, ...(provisionedUid ? { authUid: provisionedUid } : {}), territoryAssignmentCount: 0, productAssignmentCount: 0, readiness, status: provisionedUid ? "PARTIAL" : "FAILED", resourceIds: [], error: error?.message || String(error) };
  }
}
