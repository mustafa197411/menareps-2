import type { OperationalScopeSessionStatus } from "./operationalScopeSession";
import type { ReadinessReport } from "./userPolicyEngine";

export interface BaseSessionInitializationInput {
  authReady: boolean;
  profileLoaded: boolean;
  permissionsReady: boolean;
  policyReady: boolean;
  sessionHydrationComplete: boolean;
  readinessStatus: ReadinessReport["status"];
  operationalScopeStatus: OperationalScopeSessionStatus;
}

export interface BaseSessionInitializationDecision {
  ready: boolean;
  operationalScopeAvailable: boolean;
}

export type SessionDomState = "INITIALIZING" | "OPERATIONAL" | "NON_OPERATIONAL" | "ERROR";

/** Presentation-only mapping of the existing session state machine. */
export function resolveSessionDomState(input: {
  sessionReady: boolean;
  isSessionInitializing: boolean;
  hasInitializationError: boolean;
}): SessionDomState {
  if (input.hasInitializationError) return "ERROR";
  if (input.sessionReady) return "OPERATIONAL";
  return input.isSessionInitializing ? "INITIALIZING" : "NON_OPERATIONAL";
}

/**
 * Base application readiness and WP5.2E resource authority are deliberately
 * separate. A denied or failed operational scope never becomes authority, but
 * it also does not invalidate an otherwise ready authenticated session.
 */
export function evaluateBaseSessionInitialization(
  input: BaseSessionInitializationInput,
): BaseSessionInitializationDecision {
  return {
    ready:
      input.authReady
      && input.profileLoaded
      && input.permissionsReady
      && input.policyReady
      && input.sessionHydrationComplete
      && input.readinessStatus === "Operational",
    operationalScopeAvailable: input.operationalScopeStatus === "READY",
  };
}
