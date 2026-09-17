import type { User } from "firebase/auth";
import { auth } from "./firebase";

export type ResourceReadContext =
  | { purpose: "MANAGEMENT" }
  | { purpose: "PHYSICIAN_VISIT"; contextId: string; productId: string }
  | { purpose: "PRODUCT_DETAIL"; productId: string };

export class ResourceReadClientError extends Error { constructor(public code: string, public status: number) { super(code); } }

async function call<T>(path: string, body: unknown, user: Pick<User, "getIdToken"> | null = auth.currentUser, fetcher: typeof fetch = fetch): Promise<T> {
  if (!user) throw new ResourceReadClientError("AUTHENTICATION_REQUIRED", 401);
  const response = await fetcher(path, { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) { const row = await response.json().catch(() => ({})) as any; throw new ResourceReadClientError(row.code || "RESOURCE_READ_FAILED", response.status); }
  return response.json() as Promise<T>;
}

export async function createResourceVisitContext(input: { physicianId: string; visitDate: string; plannerVisitId?: string }) {
  return call<{ contextId: string; visitId: string; physicianId: string; visitDate: string; kind: "PLANNED" | "AD_HOC"; expiresAt: string; eligibleProductIds: string[] }>("/api/resources/visit-contexts", input);
}
export async function discoverManagementResources() {
  if (!auth.currentUser) throw new ResourceReadClientError("AUTHENTICATION_REQUIRED", 401);
  const response = await fetch("/api/resources/management", { headers: { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } });
  if (!response.ok) { const row = await response.json().catch(() => ({})) as any; throw new ResourceReadClientError(row.code || "RESOURCE_READ_FAILED", response.status); }
  return response.json() as Promise<{ resources: any[] }>;
}
export const discoverVisitResources = (contextId: string) => call<{ contextId: string; physicianId: string; visitDate: string; eligibleProductIds: string[]; resourcesByProduct: Record<string, any[]> }>("/api/resources/visit/discover", { contextId });
export const discoverProductResources = (productId: string) => call<{ productId: string; resources: any[] }>("/api/resources/product/discover", { productId });

export async function fetchAuthorizedResourceBlob(resourceId: string, context: ResourceReadContext, range?: string, user: Pick<User, "getIdToken"> | null = auth.currentUser, fetcher: typeof fetch = fetch): Promise<{ blob: Blob; filename?: string }> {
  if (!user) throw new ResourceReadClientError("AUTHENTICATION_REQUIRED", 401);
  const response = await fetcher(`/api/resources/${encodeURIComponent(resourceId)}/binary`, { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json", ...(range ? { Range: range } : {}) }, body: JSON.stringify({ context }) });
  if (!response.ok) { const row = await response.json().catch(() => ({})) as any; throw new ResourceReadClientError(row.code || "RESOURCE_READ_FAILED", response.status); }
  const disposition = response.headers.get("content-disposition") || "", encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1], plain = disposition.match(/filename="([^"]+)"/i)?.[1];
  return { blob: await response.blob(), filename: encoded ? decodeURIComponent(encoded) : plain };
}

export const fetchActiveResourceHotspots = (resourceId: string, context: ResourceReadContext, pageNumber?: number) => call<{ hotspots: any[] }>(`/api/resources/${encodeURIComponent(resourceId)}/hotspots`, { context, ...(pageNumber === undefined ? {} : { pageNumber }) });
export const discoverManagedResourceHotspots = (resourceId: string) => call<{ hotspots: any[]; products: any[]; keyMessages: any[]; canCreate: boolean }>(`/api/resources/${encodeURIComponent(resourceId)}/hotspots/manage/discover`, {});
export const createManagedResourceHotspot = (resourceId: string, input: Record<string, unknown>) => call<{ hotspot: any }>(`/api/resources/${encodeURIComponent(resourceId)}/hotspots/manage/create`, input);
export const updateManagedResourceHotspot = (resourceId: string, hotspotId: string, input: Record<string, unknown>) => call<{ hotspot: any }>(`/api/resources/${encodeURIComponent(resourceId)}/hotspots/${encodeURIComponent(hotspotId)}/manage/update`, input);
export const deactivateManagedResourceHotspot = (resourceId: string, hotspotId: string) => call<{ hotspotId: string; active: false }>(`/api/resources/${encodeURIComponent(resourceId)}/hotspots/${encodeURIComponent(hotspotId)}/manage/deactivate`, {});
export const recordResourceHotspotInteraction = (resourceId: string, hotspotId: string, input: { contextId: string; productId: string; usageSessionId?: string }) => call<{ interactionId: string; recorded: true }>(`/api/resources/${encodeURIComponent(resourceId)}/hotspots/${encodeURIComponent(hotspotId)}/interactions`, input);
