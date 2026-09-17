import type { User as FirebaseUser } from "firebase/auth";
import type { Physician } from "../types";

export interface ScopedPhysicianReadResponse {
  authorized: boolean;
  code?: string;
  physicians: Physician[];
}

export type PhysicianReadStatus = "UNINITIALIZED" | "LOADING" | "READY" | "DENIED" | "ERROR";

export interface PhysicianReadState {
  status: PhysicianReadStatus;
  actorUid: string | null;
  physicians: Physician[];
}

export const EMPTY_PHYSICIAN_READ_STATE: PhysicianReadState = {
  status: "UNINITIALIZED",
  actorUid: null,
  physicians: [],
};

const isPhysician = (value: unknown): value is Physician => {
  if (!value || typeof value !== "object") return false;
  const physician = value as Record<string, unknown>;
  return typeof physician.id === "string"
    && typeof physician.name === "string"
    && typeof physician.specialty === "string"
    && typeof physician.classification === "string"
    && typeof physician.territory === "string"
    && typeof physician.region === "string"
    && typeof physician.address === "string";
};

export function isScopedPhysicianReadResponse(value: unknown): value is ScopedPhysicianReadResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response.authorized === "boolean"
    && Array.isArray(response.physicians)
    && response.physicians.every(isPhysician);
}

export async function fetchScopedPhysicians(
  user: Pick<FirebaseUser, "getIdToken">,
  fetchImplementation: typeof fetch = fetch,
): Promise<ScopedPhysicianReadResponse> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/physicians/scoped-query", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const payload: unknown = await response.json();
  if (!isScopedPhysicianReadResponse(payload)) {
    throw new Error("Malformed scoped-physician response");
  }
  return payload;
}

export interface PhysicianReadController {
  getState(): PhysicianReadState;
  subscribe(listener: (state: PhysicianReadState) => void): () => void;
  load(actorUid: string, user: Pick<FirebaseUser, "getIdToken">): Promise<void>;
  clear(): void;
}

export function createPhysicianReadController(
  loader: (user: Pick<FirebaseUser, "getIdToken">) => Promise<ScopedPhysicianReadResponse> = fetchScopedPhysicians,
): PhysicianReadController {
  let state = EMPTY_PHYSICIAN_READ_STATE;
  let generation = 0;
  const listeners = new Set<(state: PhysicianReadState) => void>();
  const publish = (next: PhysicianReadState) => {
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
    async load(actorUid, user) {
      const requestGeneration = ++generation;
      publish({ status: "LOADING", actorUid, physicians: [] });
      try {
        const result = await loader(user);
        if (requestGeneration !== generation) return;
        if (!result.authorized) {
          publish({ status: "DENIED", actorUid, physicians: [] });
          return;
        }
        const deduplicated = new Map(result.physicians.map((physician) => [physician.id, physician]));
        publish({
          status: "READY",
          actorUid,
          physicians: Array.from(deduplicated.values()).sort((left, right) => left.id.localeCompare(right.id)),
        });
      } catch {
        if (requestGeneration === generation) {
          publish({ status: "ERROR", actorUid, physicians: [] });
        }
      }
    },
    clear() {
      generation += 1;
      publish(EMPTY_PHYSICIAN_READ_STATE);
    },
  };
}
