import { CANONICAL_USER_ROLES, normalizeRole, Role, type Permissions } from "../src/types";
import { canCreateRole } from "../src/lib/userPolicyEngine";

export interface ProvisioningRequest {
  email: string;
  name: string;
  password?: string;
  disabled: boolean;
  role: Role;
}

const SINGLETON_ROLE_MESSAGES: Partial<Record<Role, string>> = {
  [Role.SUPER_ADMIN]: "A Super Admin already exists for this MENAREPS installation.",
  [Role.ADMIN]: "An Admin already exists for this MENAREPS installation.",
  [Role.GENERAL_MANAGER]: "A General Manager already exists for this MENAREPS installation.",
};

export class ProvisioningConflictError extends Error {
  readonly code = "PROVISIONING_SINGLETON_ROLE_EXISTS";
  readonly status = 409;
}

/** Installation-wide singleton validation. This must run before any Firebase Auth mutation. */
export async function assertSingletonProvisioningRoleAvailable(
  db: FirebaseFirestore.Firestore,
  targetRole: Role,
): Promise<void> {
  const message = SINGLETON_ROLE_MESSAGES[targetRole];
  if (!message) return;
  const [users, activationProfiles] = await Promise.all([
    db.collection("users").where("role", "==", targetRole).get(),
    db.collection("userActivationProfiles").where("role", "==", targetRole).get(),
  ]);
  const existing = [...users.docs, ...activationProfiles.docs]
    .some(snapshot => snapshot.data().isDeleted !== true);
  if (existing) throw new ProvisioningConflictError(message);
}

export function parseProvisioningRequest(payload: Record<string, unknown>): ProvisioningRequest {
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : undefined;
  const disabled = payload.disabled === true;
  const normalizedRole = normalizeRole(typeof payload.role === "string" ? payload.role : "") as Role;
  if (!email || !name || !CANONICAL_USER_ROLES.includes(normalizedRole)) throw new Error("INVALID_PROVISIONING_REQUEST");
  if (!disabled && (!password || password.length < 6)) throw new Error("EXPLICIT_INITIAL_CREDENTIAL_REQUIRED");
  if (password && password.length < 6) throw new Error("INVALID_INITIAL_CREDENTIAL");
  return { email, name, password, disabled, role: normalizedRole };
}

export function authorizeProvisioning(caller: { role: string; active?: boolean; loginAllowed?: boolean }, permissions: (Permissions & { active?: boolean }) | null, targetRole: Role): void {
  const callerRole = normalizeRole(caller.role) as Role;
  if (caller.active === false || caller.loginAllowed === false) throw new Error("INACTIVE_PROVISIONING_ACTOR");
  const canonicalInstallationAdministrator = callerRole === Role.SUPER_ADMIN || callerRole === Role.ADMIN;
  if (!canonicalInstallationAdministrator && (!permissions || permissions.active === false || permissions.create !== true)) throw new Error("PROVISIONING_PERMISSION_DENIED");
  if (!CANONICAL_USER_ROLES.includes(callerRole) || !canCreateRole(callerRole, targetRole)) throw new Error("TARGET_ROLE_CREATION_DENIED");
}
