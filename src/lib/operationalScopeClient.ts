import type { User as FirebaseUser } from "firebase/auth";
import { formatMarketCurrency, validateMarketSettings, type MarketBusinessSettings } from "./marketSettings";

export type ActorMarketContext = { status: "RESOLVED"; market: MarketBusinessSettings } | { status: "UNRESOLVED" };
export function isActorMarketContext(value: unknown): value is ActorMarketContext {
  if (!value || typeof value !== "object") return false;
  const context = value as ActorMarketContext;
  if (context.status === "UNRESOLVED") return true;
  try { return context.status === "RESOLVED" && context.market.active === true && validateMarketSettings(context.market).length === 0; } catch { return false; }
}
export function formatCanonicalProductPrice(price: unknown, context?: ActorMarketContext): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return "Product price invalid";
  if (!isActorMarketContext(context) || context.status !== "RESOLVED") return "Market configuration required";
  try { return formatMarketCurrency(price, context.market); } catch { return "Market configuration required"; }
}

export type OperationalBoundaryKind = "AREA" | "COUNTRY" | "REGION" | "GLOBAL";
export type OperationalSubjectMode = "SELF" | "HIERARCHY";

export interface CanonicalOperationalScope {
  marketContext?: ActorMarketContext;
  authorized: boolean;
  code?: string;
  actorUid?: string;
  role?: string;
  boundaryKind?: OperationalBoundaryKind;
  subjectMode?: OperationalSubjectMode;
  subjectUids: string[];
  authorizedRepresentativeUids: string[];
  countryIds: string[];
  regionIds: string[];
  districtIds: string[];
  cityIds: string[];
  areaIds: string[];
  productIds: string[];
  productGroupIds: string[];
  queryPlan: {
    denyAll: boolean;
    areaIdChunks: string[][];
    subjectUidChunks: string[][];
    productIdChunks: string[][];
    requiresPostFilter: boolean;
  };
  diagnostics: {
    excludedAssignmentIds: string[];
    malformedAssignmentIds: string[];
    outsideBoundaryAssignmentIds: string[];
  };
}

export interface OperationalScopeTokenProvider {
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const stringChunks = (value: unknown): value is string[][] =>
  Array.isArray(value) && value.every(stringArray);

export const isCanonicalOperationalScope = (value: unknown): value is CanonicalOperationalScope => {
  if (!value || typeof value !== "object") return false;
  const scope = value as Record<string, any>;
  const plan = scope.queryPlan;
  const diagnostics = scope.diagnostics;

  return typeof scope.authorized === "boolean"
    && (scope.marketContext === undefined || isActorMarketContext(scope.marketContext))
    && stringArray(scope.subjectUids)
    && stringArray(scope.authorizedRepresentativeUids)
    && stringArray(scope.countryIds)
    && stringArray(scope.regionIds)
    && stringArray(scope.districtIds)
    && stringArray(scope.cityIds)
    && stringArray(scope.areaIds)
    && stringArray(scope.productIds)
    && stringArray(scope.productGroupIds)
    && plan && typeof plan === "object"
    && typeof plan.denyAll === "boolean"
    && stringChunks(plan.areaIdChunks)
    && stringChunks(plan.subjectUidChunks)
    && stringChunks(plan.productIdChunks)
    && typeof plan.requiresPostFilter === "boolean"
    && diagnostics && typeof diagnostics === "object"
    && stringArray(diagnostics.excludedAssignmentIds)
    && stringArray(diagnostics.malformedAssignmentIds)
    && stringArray(diagnostics.outsideBoundaryAssignmentIds);
};

export async function fetchCanonicalOperationalScope(
  user: Pick<FirebaseUser, "getIdToken"> | OperationalScopeTokenProvider,
  fetchImplementation: typeof fetch = fetch,
): Promise<CanonicalOperationalScope> {
  const token = await user.getIdToken();
  const response = await fetchImplementation("/api/operational-scope", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const payload: unknown = await response.json();
  if (!isCanonicalOperationalScope(payload)) {
    throw new Error("Malformed operational-scope response");
  }
  return payload;
}
