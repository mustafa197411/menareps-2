import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../types";

const firebaseState = vi.hoisted(() => ({ currentUser: { uid: "ACTOR_CLIENT", getIdToken: vi.fn(async () => "TOKEN") } as any }));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), collection: vi.fn(), addDoc: vi.fn(), writeBatch: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(), runTransaction: vi.fn(),
}));
vi.mock("./firebase", () => ({ auth: firebaseState, db: {} }));

import { canonicalProductClientPayload, isRetryableProductPersistenceError, ProductPersistenceClientError, saveProduct, saveProductBatch } from "./firestoreService";

const product = (overrides: Record<string, unknown> = {}) => ({
  id: "PRODUCT_DOCUMENT", name: "Example", brand: "Example Brand", therapeuticArea: "Example Area", price: 12, stock: 34,
  sku: "BUSINESS_SKU", code: "BUSINESS_CODE", ...overrides,
}) as Product;

describe("Product persistence canonical identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseState.currentUser = { uid: "ACTOR_CLIENT", getIdToken: vi.fn(async () => "TOKEN") };
  });

  it("sends Add Product through the authenticated backend with explicit create semantics", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "CREATED", product: { ...product(), productId: "PRODUCT_DOCUMENT", active: true } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(saveProduct(product({ isActive: true }), "ACTOR_CLIENT", "create")).resolves.toMatchObject({ id: "PRODUCT_DOCUMENT", productId: "PRODUCT_DOCUMENT", active: true });
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0];
    expect(init.headers).toEqual({ Authorization: "Bearer TOKEN", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toMatchObject({ operation: "create", productId: "PRODUCT_DOCUMENT", product: { id: "PRODUCT_DOCUMENT", isActive: true, sku: "BUSINESS_SKU", code: "BUSINESS_CODE" } });
  });

  it("strips client identity and audit metadata from authenticated Edit Product", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "UPDATED", product: { ...product(), productId: "PRODUCT_DOCUMENT", active: false } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    await saveProduct(product({ productId: "FORM_REPLACEMENT", active: true, createdAt: "CLIENT_TIME", createdBy: "CLIENT_ACTOR", updatedAt: "CLIENT_TIME", updatedBy: "CLIENT_ACTOR", importedAt: "CLIENT_TIME", importedBy: "CLIENT_ACTOR", isActive: false }), "ACTOR_CLIENT", "edit");
    const request = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(request.operation).toBe("edit");
    for (const field of ["productId", "active", "createdAt", "createdBy", "updatedAt", "updatedBy", "importedAt", "importedBy"]) expect(request.product).not.toHaveProperty(field);
    expect(request.product).toMatchObject({ id: "PRODUCT_DOCUMENT", isActive: false, sku: "BUSINESS_SKU", code: "BUSINESS_CODE", price: 12 });
    expect(canonicalProductClientPayload(product({ productId: "BAD", createdAt: "BAD" }))).not.toHaveProperty("productId");
  });

  it("fails closed without the matching authenticated Firebase user", async () => {
    firebaseState.currentUser = null;
    await expect(saveProduct(product({ isActive: true }), "ACTOR_CLIENT", "create")).rejects.toThrow("PRODUCT_AUTHENTICATION_REQUIRED");
  });

  it.each([400, 401, 403, 404, 409, 500])("marks an HTTP %s Product rejection as non-retryable", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "PRODUCT_REJECTED" }), { status, headers: { "Content-Type": "application/json" } })));
    const failure = await saveProduct(product({ isActive: true }), "ACTOR_CLIENT", "create").catch(error => error);
    expect(failure).toMatchObject({ code: "PRODUCT_REJECTED", status, retryable: false });
    expect(isRetryableProductPersistenceError(failure)).toBe(false);
  });

  it("marks only a transport failure as queueable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network unavailable"); }));
    const failure = await saveProduct(product({ isActive: true }), "ACTOR_CLIENT", "create").catch(error => error);
    expect(failure).toBeInstanceOf(ProductPersistenceClientError);
    expect(failure).toMatchObject({ code: "PRODUCT_NETWORK_UNAVAILABLE", status: 0, retryable: true });
    expect(isRetryableProductPersistenceError(failure)).toBe(true);
  });

  it("fails closed when token acquisition fails without inferring connectivity", async () => {
    for (const code of ["auth/user-token-expired", "auth/network-request-failed"]) {
      firebaseState.currentUser = { uid: "ACTOR_CLIENT", getIdToken: vi.fn(async () => { throw { code }; }) };
      const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
      const failure = await saveProduct(product({ isActive: true }), "ACTOR_CLIENT", "create").catch(error => error);
      expect(failure).toMatchObject({ code: "PRODUCT_TOKEN_ACQUISITION_FAILED", status: 0, retryable: false });
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it("sends an atomic Product import request with stripped audit metadata", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "COMPLETED", products: [{ status: "CREATED", product: { ...product(), productId: "PRODUCT_DOCUMENT", active: true } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    await saveProductBatch([{ operation: "create", productId: "PRODUCT_DOCUMENT", product: product({ isActive: true, createdAt: "CLIENT_TIME", importedAt: "CLIENT_TIME", importedBy: "CLIENT_ACTOR", source: "synthetic" }) }], "ACTOR_CLIENT");
    const request = JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(request.commands).toHaveLength(1);
    expect(request.commands[0]).toMatchObject({ operation: "create", productId: "PRODUCT_DOCUMENT", product: { isActive: true } });
    expect(request.commands[0].product).not.toHaveProperty("createdAt");
    expect(request.commands[0].product).not.toHaveProperty("importedAt");
    expect(request.commands[0].product).not.toHaveProperty("importedBy");
    expect(request.commands[0].product).toMatchObject({ source: "synthetic" });
  });
});
