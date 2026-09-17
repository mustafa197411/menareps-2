import { auth } from "./firebase";

export interface ProductMarketRelationshipOption { companyMarketId: string; companyId: string; marketId: string; companyName: string; marketName: string; countryName: string; currencyCode: string; configurations: Array<ProductMarketItem & { configured: boolean }> }
export interface ProductMarketItem { productId: string; unitPrice?: number; active?: boolean; saleable?: boolean; effectiveFrom?: string; catalogEntryId?: string }
export interface ProductMarketCatalogResponse { companyId: string; marketId: string; countryId: string; currencyCode: string; items: Array<ProductMarketItem & { configured: boolean }> }

export class ProductMarketCatalogClientError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); this.name = "ProductMarketCatalogClientError"; }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new ProductMarketCatalogClientError("PRODUCT_MARKET_AUTHENTICATION_REQUIRED", 401);
  let response: Response;
  try { response = await fetch(path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new ProductMarketCatalogClientError("PRODUCT_MARKET_REQUEST_FAILED", 0); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProductMarketCatalogClientError(typeof payload.code === "string" ? payload.code : "PRODUCT_MARKET_REQUEST_FAILED", response.status);
  return payload as T;
}

export async function getProductMarketRelationships(productIds: string[]): Promise<ProductMarketRelationshipOption[]> {
  const response = await request<{ relationships: ProductMarketRelationshipOption[] }>("/api/products/market-catalog/options", { productIds });
  return response.relationships;
}
export const saveProductMarketCatalog = (companyId: string, marketId: string, items: Array<ProductMarketItem & { unitPrice: number; active: boolean; saleable: boolean }>) => request<ProductMarketCatalogResponse>("/api/products/market-catalog/save", { companyId, marketId, items });
