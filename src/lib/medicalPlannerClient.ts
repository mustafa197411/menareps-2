import { auth } from "./firebase";

export interface MedicalPlannerMutationProposal {
  id: string; repId: string; physicianId: string; date: string; time?: string;
  planningType: "weekly" | "monthly"; week: string; month: string; isUnplanned?: boolean;
}

export async function createAuthorizedMedicalPlan(proposal: MedicalPlannerMutationProposal, mode: "MANUAL" | "AUTO" = "MANUAL") {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("AUTHENTICATED_PLANNER_ACTOR_REQUIRED");
  const response = await fetch("/api/medical-planner/mutate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode, proposal }) });
  const result = await response.json().catch(() => ({ code: "INVALID_PLANNER_RESPONSE" }));
  if (!response.ok || result.status !== "SAVED") throw new Error(result.code || "MEDICAL_PLANNER_MUTATION_FAILED");
  return result as { status: "SAVED"; id: string; marketId: string };
}

export interface MedicalPlannerScopedReadRequest {
  repId: string;
  planningType: "weekly" | "monthly";
  period?: string;
}

async function authorizedPost(path: string, body: unknown) {
  const current = auth.currentUser;
  if (!current) throw new Error("AUTHENTICATED_PLANNER_ACTOR_REQUIRED");
  const token = await current.getIdToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.code || "MEDICAL_PLANNER_AUTHORIZATION_FAILED");
  return result;
}

export function fetchAuthorizedMedicalPlanner(request: MedicalPlannerScopedReadRequest) {
  return authorizedPost("/api/medical-planner/scoped-read", request);
}

export function executeAuthorizedMedicalPlannerAction(
  request: MedicalPlannerScopedReadRequest & {
    action: "REMOVE_VISIT" | "CLEAR_PERIOD" | "SAVE_WEEK";
    visitId?: string;
    visitIds?: string[];
  },
) {
  return authorizedPost("/api/medical-planner/scoped-action", request);
}

export function saveAuthorizedMedicalPlannerWeek(request: MedicalPlannerScopedReadRequest & { visitIds: string[] }) {
  return executeAuthorizedMedicalPlannerAction({ ...request, action: "SAVE_WEEK", visitIds: request.visitIds });
}
