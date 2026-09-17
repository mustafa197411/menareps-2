import { Role, User, UserProductAssignment, UserTerritoryAssignment } from "../types";
import { getReadiness, ReadinessReport } from "./userPolicyEngine";

export type UserOperationalBadgeState =
  | "OPERATIONAL"
  | "ASSIGNMENTS_LOADING"
  | "AWAITING_GEOGRAPHY"
  | "AWAITING_OPERATIONAL";

export interface UserOperationalBadgeResult {
  state: UserOperationalBadgeState;
  readiness: ReadinessReport;
}

export interface UserOperationalBadgeInputs {
  territoryAssignments: UserTerritoryAssignment[];
  productAssignments: UserProductAssignment[];
  territoryAssignmentsHydrated: boolean;
  productAssignmentsHydrated: boolean;
}

export function getUserOperationalBadge(
  user: User,
  users: User[],
  inputs: UserOperationalBadgeInputs,
): UserOperationalBadgeResult {
  const uid = user.id || user.uid || "";
  const territoryAssignments = inputs.territoryAssignments.filter(assignment => assignment.userId === uid);
  const productAssignments = inputs.productAssignments.filter(assignment => assignment.userId === uid);
  const assignmentsHydrated = inputs.territoryAssignmentsHydrated && inputs.productAssignmentsHydrated;
  const readiness = getReadiness(user, users, {
    territoryAssignments,
    productAssignments,
    assignmentsHydrated,
  });

  if (readiness.status === "Operational") {
    return { state: "OPERATIONAL", readiness };
  }

  const isRepresentative = user.role === Role.MEDICAL_REP || user.role === Role.SALES_REP;
  if (isRepresentative && readiness.reasons.includes("CANONICAL_ASSIGNMENTS_NOT_HYDRATED")) {
    return { state: "ASSIGNMENTS_LOADING", readiness };
  }
  if (isRepresentative && readiness.reasons.includes("AREA_ASSIGNMENT_MISSING")) {
    return { state: "AWAITING_GEOGRAPHY", readiness };
  }
  return { state: "AWAITING_OPERATIONAL", readiness };
}
