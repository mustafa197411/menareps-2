import type { User } from "../types";
import type { OperationalScopeSessionState } from "./operationalScopeSession";

/** Returns display records only after the authenticated canonical session authorizes their UIDs. */
export function resolveAuthorizedMedicalPlannerRepresentatives(
  currentUser: Pick<User, "id">,
  users: readonly User[],
  session: OperationalScopeSessionState,
): User[] {
  const scope = session.scope;
  if (session.status !== "READY"
    || session.actorUid !== currentUser.id
    || !scope
    || scope.actorUid !== currentUser.id
    || scope.authorized !== true
    || scope.queryPlan?.denyAll !== false) return [];
  const subjects = new Set(scope.subjectUids || []);
  const representatives = new Set(scope.authorizedRepresentativeUids || []);
  return users.filter((user) => subjects.has(user.id) && representatives.has(user.id));
}
