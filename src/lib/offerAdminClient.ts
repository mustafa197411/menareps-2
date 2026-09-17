import { isActorMarketContext, type ActorMarketContext } from "./operationalScopeClient";
import { auth } from "./firebase";
import type { OfferCapability, CanonicalOfferDefinition, LegacyOfferPresentation } from "../features/offers/types";

export type OfferAdminReadRecord =
  | { kind: "CANONICAL"; offer: CanonicalOfferDefinition }
  | { kind: "LEGACY"; offer: LegacyOfferPresentation };

export type OfferAdminClientErrorCode =
  | "OFFER_AUTHENTICATION_REQUIRED" | "OFFER_PERMISSION_DENIED" | "OFFER_STALE_REVISION"
  | "OFFER_READ_FAILED" | "OFFER_WRITE_FAILED" | string;

export class OfferAdminClientError extends Error {
  constructor(public readonly code: OfferAdminClientErrorCode, public readonly status = 0) {
    super(code);
    this.name = "OfferAdminClientError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const failureCode = init?.method === "POST" && path !== "/api/offers/representative-options" ? "OFFER_WRITE_FAILED" : "OFFER_READ_FAILED";
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new OfferAdminClientError("OFFER_AUTHENTICATION_REQUIRED", 401);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
  } catch {
    throw new OfferAdminClientError(failureCode, 0);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new OfferAdminClientError(typeof body.code === "string" ? body.code : failureCode, response.status);
  return body as T;
}

export interface OfferAdminListResponse {
  offers: OfferAdminReadRecord[];
  capabilities: Record<OfferCapability, boolean>;
  continuation?: string;
}

export interface OfferProductOption { id: string; name: string; price: number }
export interface OfferRepresentativeOption { id: string; name: string }
export interface OfferProductOptionsResponse { products: OfferProductOption[]; marketContext: ActorMarketContext; continuation?: string }
export interface OfferRepresentativeOptionsResponse { representatives: OfferRepresentativeOption[]; continuationToken?: string }

export const listAdminOffers = (controls: { pageSize?: number; continuation?: string } = {}) => {
  const query = new URLSearchParams();
  if (controls.pageSize !== undefined) query.set("pageSize", String(controls.pageSize));
  if (controls.continuation !== undefined) query.set("continuation", controls.continuation);
  return request<OfferAdminListResponse>(`/api/offers${query.size ? `?${query}` : ""}`);
};
export const getAdminOffer = (id: string) => request<{ record: OfferAdminReadRecord }>(`/api/offers/${encodeURIComponent(id)}`);
export const getAdminOfferProducts = async (continuation?: string, offerId?: string) => {
  const query = new URLSearchParams();
  if (continuation) query.set("continuation", continuation);
  if (offerId) query.set("offerId", offerId);
  const response = await request<OfferProductOptionsResponse>(`/api/offers/product-options${query.size ? `?${query}` : ""}`);
  if (!isActorMarketContext(response.marketContext)) throw new OfferAdminClientError("OFFER_READ_FAILED");
  return response;
};
export const getAdminOfferRepresentatives = (controls: { offerId?: string; pageSize?: number; continuationToken?: string }) => request<OfferRepresentativeOptionsResponse>("/api/offers/representative-options", { method: "POST", body: JSON.stringify(controls) });
export const createAdminOfferDraft = (definition: unknown) => request<{ offer: CanonicalOfferDefinition }>("/api/offers/drafts", { method: "POST", body: JSON.stringify({ definition }) });
export const mutateAdminOffer = (command: unknown) => request<{ offer: CanonicalOfferDefinition }>("/api/offers/actions", { method: "POST", body: JSON.stringify(command) });
