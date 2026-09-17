import {
  nextVisitMarketingRequestStatus,
  type VisitMarketingRequestAction,
  type VisitMarketingRequestStatus,
} from "./visitMarketingRequestPolicy";

export type VisitMarketingRequestGovernedAction = Exclude<VisitMarketingRequestAction, "CREATE">;

const REVIEW_ACTIONS: readonly VisitMarketingRequestGovernedAction[] = [
  "SUPERVISOR_APPROVE",
  "SUPERVISOR_REJECT",
  "FINAL_APPROVE",
  "FINAL_REJECT",
  "EXECUTE",
];

export function presentationActionsForVisitMarketingRequest(
  status: VisitMarketingRequestStatus,
  isCreator: boolean,
): VisitMarketingRequestGovernedAction[] {
  if (isCreator) return nextVisitMarketingRequestStatus(status, "CANCEL") ? ["CANCEL"] : [];
  return REVIEW_ACTIONS.filter(action => nextVisitMarketingRequestStatus(status, action) !== null);
}

export function visitMarketingRequestActionRequiresText(action: VisitMarketingRequestGovernedAction): boolean {
  return action === "SUPERVISOR_REJECT" || action === "FINAL_REJECT" || action === "CANCEL" || action === "EXECUTE";
}
