import {
  fetchCanonicalOperationalScope,
  type CanonicalOperationalScope,
  type OperationalScopeTokenProvider,
} from "./operationalScopeClient";

export type OperationalScopeSessionStatus =
  | "UNINITIALIZED"
  | "LOADING"
  | "READY"
  | "DENIED"
  | "ERROR";

export interface OperationalScopeSessionState {
  status: OperationalScopeSessionStatus;
  actorUid: string | null;
  scope: CanonicalOperationalScope | null;
}

export const EMPTY_OPERATIONAL_SCOPE_SESSION: OperationalScopeSessionState = {
  status: "UNINITIALIZED",
  actorUid: null,
  scope: null,
};

type Listener = (state: OperationalScopeSessionState) => void;
type ScopeLoader = (user: OperationalScopeTokenProvider) => Promise<CanonicalOperationalScope>;

export interface OperationalScopeSessionController {
  getState(): OperationalScopeSessionState;
  subscribe(listener: Listener): () => void;
  bootstrap(actorUid: string, user: OperationalScopeTokenProvider): Promise<void>;
  clear(): void;
}

export function createOperationalScopeSessionController(
  loadScope: ScopeLoader = fetchCanonicalOperationalScope,
): OperationalScopeSessionController {
  let state = EMPTY_OPERATIONAL_SCOPE_SESSION;
  let generation = 0;
  const listeners = new Set<Listener>();

  const publish = (next: OperationalScopeSessionState) => {
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async bootstrap(actorUid, user) {
      const requestGeneration = ++generation;
      publish({ status: "LOADING", actorUid, scope: null });

      try {
        const scope = await loadScope(user);
        if (requestGeneration !== generation) return;
        if (scope.actorUid && scope.actorUid !== actorUid) {
          publish({ status: "ERROR", actorUid, scope: null });
          return;
        }
        if (!scope.authorized || scope.queryPlan.denyAll) {
          publish({ status: "DENIED", actorUid, scope: null });
          return;
        }
        publish({ status: "READY", actorUid, scope });
      } catch {
        if (requestGeneration === generation) {
          publish({ status: "ERROR", actorUid, scope: null });
        }
      }
    },
    clear() {
      generation += 1;
      publish(EMPTY_OPERATIONAL_SCOPE_SESSION);
    },
  };
}
