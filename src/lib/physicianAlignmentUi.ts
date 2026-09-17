import { Physician, Role, User, UserProductAssignment, UserTerritoryAssignment } from "../types";

export type RepresentativeResolutionStatus =
  | "AUTO_ASSIGNED"
  | "MANUAL_ASSIGNMENT_REQUIRED"
  | "NO_ELIGIBLE_MEDICAL_REP";

export interface PhysicianAssignmentResolution {
  eligibleRepresentativeIds: string[];
  assignedRepId?: string;
  assignedSupervisorId?: string;
  assignedManagerId?: string;
  representativeStatus: RepresentativeResolutionStatus;
  supervisorStatus?: "RESOLVED" | "SUPERVISOR_NOT_RESOLVED";
  managerStatus?: "RESOLVED" | "MANAGER_NOT_RESOLVED";
}

const isActiveUser = (user: User): boolean =>
  user.active !== false &&
  user.isDeleted !== true &&
  user.employmentStatus !== "Inactive" &&
  user.accountStatus !== "INACTIVE" &&
  user.status !== "Inactive";

/** Resolves eligible representatives and their UID-only reporting cascade. */
export function resolvePhysicianOperationalAssignment({
  areaId,
  alignedProductIds,
  requestedRepId,
  users,
  userTerritoryAssignments,
  userProductAssignments
}: {
  areaId?: string;
  alignedProductIds: string[];
  requestedRepId?: string;
  users: User[];
  userTerritoryAssignments: UserTerritoryAssignment[];
  userProductAssignments: UserProductAssignment[];
}): PhysicianAssignmentResolution {
  const alignedIds = new Set(alignedProductIds.filter(Boolean));
  const areaOwnerIds = new Set(
    userTerritoryAssignments
      .filter(a => a.status === "Active" && a.userId && a.territoryId === areaId)
      .map(a => a.userId)
  );
  const productOwnerIds = new Set(
    userProductAssignments
      .filter(a => a.status === "Active" && a.active !== false && alignedIds.has(a.productId))
      .map(a => a.userId)
  );
  const eligibleRepresentativeIds = users
    .filter(user =>
      user.role === Role.MEDICAL_REP &&
      isActiveUser(user) &&
      areaOwnerIds.has(user.id) &&
      productOwnerIds.has(user.id)
    )
    .map(user => user.id)
    .sort();

  let assignedRepId: string | undefined;
  let representativeStatus: RepresentativeResolutionStatus;
  if (eligibleRepresentativeIds.length === 1) {
    assignedRepId = eligibleRepresentativeIds[0];
    representativeStatus = "AUTO_ASSIGNED";
  } else if (eligibleRepresentativeIds.length > 1) {
    assignedRepId = requestedRepId && eligibleRepresentativeIds.includes(requestedRepId)
      ? requestedRepId
      : undefined;
    representativeStatus = "MANUAL_ASSIGNMENT_REQUIRED";
  } else {
    representativeStatus = "NO_ELIGIBLE_MEDICAL_REP";
  }

  if (!assignedRepId) {
    return { eligibleRepresentativeIds, representativeStatus };
  }

  const representative = users.find(user => user.id === assignedRepId);
  const supervisor = representative?.managerId
    ? users.find(user => user.id === representative.managerId && user.role === Role.MEDICAL_SUPERVISOR && isActiveUser(user))
    : undefined;
  if (!supervisor) {
    return {
      eligibleRepresentativeIds,
      assignedRepId,
      representativeStatus,
      supervisorStatus: "SUPERVISOR_NOT_RESOLVED"
    };
  }

  const manager = supervisor.managerId
    ? users.find(user => user.id === supervisor.managerId && user.role === Role.MEDICAL_MANAGER && isActiveUser(user))
    : undefined;
  return {
    eligibleRepresentativeIds,
    assignedRepId,
    assignedSupervisorId: supervisor.id,
    assignedManagerId: manager?.id,
    representativeStatus,
    supervisorStatus: "RESOLVED",
    managerStatus: manager ? "RESOLVED" : "MANAGER_NOT_RESOLVED"
  };
}

export function getCanonicalPhysicianProductSelection(physician: Pick<Physician, "alignedProductIds">): string[] {
  return [...(physician.alignedProductIds || [])];
}

export function toggleCanonicalProductSelection(
  selectedProductIds: string[],
  productId: string
): string[] {
  return selectedProductIds.includes(productId)
    ? selectedProductIds.filter(id => id !== productId)
    : [...selectedProductIds, productId];
}

export async function persistPhysicianBeforeSuccess(
  physician: Physician,
  persist: (physician: Physician) => Promise<void>,
  onSuccess: () => void
): Promise<void> {
  await persist(physician);
  onSuccess();
}
