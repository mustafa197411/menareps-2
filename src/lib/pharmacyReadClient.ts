import type { User as FirebaseUser } from "firebase/auth";
import type { Pharmacy } from "../types";

export interface ScopedPharmacyReadResponse {
  authorized: boolean;
  code?: string;
  pharmacies: Pharmacy[];
}

export type PharmacyReadStatus = "UNINITIALIZED" | "LOADING" | "READY" | "DENIED" | "ERROR";

export interface PharmacyReadState {
  status: PharmacyReadStatus;
  actorUid: string | null;
  pharmacies: Pharmacy[];
}

export const EMPTY_PHARMACY_READ_STATE: PharmacyReadState = {
  status: "UNINITIALIZED",
  actorUid: null,
  pharmacies: [],
};

const isPharmacy = (value: unknown): value is Pharmacy => {
  if (!value || typeof value !== "object") return false;
  const pharmacy = value as Record<string, unknown>;
  return typeof pharmacy.id === "string"
    && typeof pharmacy.name === "string"
    && typeof pharmacy.territory === "string"
    && typeof pharmacy.region === "string"
    && typeof pharmacy.address === "string";
};

export function isScopedPharmacyReadResponse(value: unknown): value is ScopedPharmacyReadResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return typeof response.authorized === "boolean"
    && Array.isArray(response.pharmacies)
    && response.pharmacies.every(isPharmacy);
}

export async function fetchScopedPharmacies(
  user: Pick<FirebaseUser, "getIdToken">,
  fetchImplementation: typeof fetch = fetch,
): Promise<ScopedPharmacyReadResponse> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/pharmacies/scoped-query", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const payload: unknown = await response.json();
  if (!isScopedPharmacyReadResponse(payload)) {
    throw new Error("Malformed scoped-pharmacy response");
  }
  return payload;
}

export interface PharmacyReadController {
  getState(): PharmacyReadState;
  subscribe(listener: (state: PharmacyReadState) => void): () => void;
  load(actorUid: string, user: Pick<FirebaseUser, "getIdToken">): Promise<void>;
  clear(): void;
}

export function createPharmacyReadController(
  loader: (user: Pick<FirebaseUser, "getIdToken">) => Promise<ScopedPharmacyReadResponse> = fetchScopedPharmacies,
): PharmacyReadController {
  let state = EMPTY_PHARMACY_READ_STATE;
  let generation = 0;
  const listeners = new Set<(state: PharmacyReadState) => void>();
  const publish = (next: PharmacyReadState) => {
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
      publish({ status: "LOADING", actorUid, pharmacies: [] });
      try {
        const result = await loader(user);
        if (requestGeneration !== generation) return;
        if (!result.authorized) {
          publish({ status: "DENIED", actorUid, pharmacies: [] });
          return;
        }
        const deduplicated = new Map(result.pharmacies.map((pharmacy) => [pharmacy.id, pharmacy]));
        publish({
          status: "READY",
          actorUid,
          pharmacies: Array.from(deduplicated.values()).sort((left, right) => left.id.localeCompare(right.id)),
        });
      } catch {
        if (requestGeneration === generation) {
          publish({ status: "ERROR", actorUid, pharmacies: [] });
        }
      }
    },
    clear() {
      generation += 1;
      publish(EMPTY_PHARMACY_READ_STATE);
    },
  };
}
