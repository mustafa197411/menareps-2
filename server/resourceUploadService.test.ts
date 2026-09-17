import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() { return { getAccessToken: async () => ({ token: "storage-token" }) }; }
  },
}));

import { authorizeResourceUpload, finalizeResourceUpload, googleStorageGateway, initiateResourceUpload, mutateResourceMetadata, parseResourceUploadAuthorization, sanitizeResourceFileName, validateResourceUploadOrigin } from "./resourceUploadService";

const command = { promotionGroupId: "PG-1", productIds: ["P-1"], resourceScope: "SELECTED_PRODUCTS" as const, originalFileName: "Clinical Study.PDF", mimeType: "application/pdf", expectedSize: 1024, metadata: { titleEn: "Study", resourceScope: "SELECTED_PRODUCTS" } };

function authorizedDb(role = "Super Admin", manage = true) {
  const create = vi.fn().mockResolvedValue(undefined);
  const db = {
    collection(name: string) {
      return {
        doc(id: string) {
          if (name === "users") return { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role, active: true, loginAllowed: true }) }) };
          if (name === "rolePermissions") return { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ resourceCapabilities: { manage } }) }) };
          if (name === "products") return { get: vi.fn().mockResolvedValue({ id, exists: true, data: () => ({ active: true, promotionGroupId: "PG-1" }) }) };
          if (name === "resourceUploadAuthorizations") return { create };
          throw new Error(`Unexpected collection ${name}`);
        },
      };
    },
  };
  return { db: db as any, create };
}

describe("resource resumable upload boundary", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("accepts a bounded canonical request and rejects oversized/unknown MIME", () => {
    const base = { promotionGroupId: "PG-1", productIds: ["P-1"], originalFileName: "Clinical Study.PDF", mimeType: "application/pdf", expectedSize: 1024, metadata: { titleEn: "Study", resourceScope: "SELECTED_PRODUCTS" } };
    expect(parseResourceUploadAuthorization(base)).toMatchObject({ promotionGroupId: "PG-1", expectedSize: 1024 });
    expect(parseResourceUploadAuthorization({ ...base, metadata: { titleEn: "Study", resourceScope: "SELECTED_PRODUCTS", actorUid: "forged", storagePath: "escape" } })?.metadata).toEqual({ titleEn: "Study", resourceScope: "SELECTED_PRODUCTS" });
    expect(parseResourceUploadAuthorization({ ...base, expectedSize: 250 * 1024 * 1024 + 1 })).toBeNull();
    expect(parseResourceUploadAuthorization({ ...base, mimeType: "application/x-executable" })).toBeNull();
  });
  it("owns a traversal-safe normalized filename", () => {
    expect(sanitizeResourceFileName("../../Quarter 1 Study.PDF")).toBe("quarter-1-study.pdf");
  });

  it("accepts and returns the exact canonical same-origin value", () => {
    expect(validateResourceUploadOrigin("https://menareps.example", "menareps.example")).toBe("https://menareps.example");
    expect(validateResourceUploadOrigin("http://localhost:3000", "localhost:3000")).toBe("http://localhost:3000");
  });

  it.each([
    [undefined, "menareps.example"],
    ["not a URL", "menareps.example"],
    ["https://evil.example", "menareps.example"],
    ["https://menareps.example.evil.test", "menareps.example"],
    ["https://menareps.example/path", "menareps.example"],
    ["http://menareps.example", "menareps.example"],
    ["https://menareps.example", "spoofed.example"],
  ])("fails closed for a missing, malformed, mismatched, or spoofed origin", (origin, host) => {
    expect(() => validateResourceUploadOrigin(origin, host)).toThrowError(expect.objectContaining({ code: "RESOURCE_UPLOAD_ORIGIN_DENIED", status: 403 }));
  });

  it("propagates the validated canonical origin without changing authorization", async () => {
    const { db } = authorizedDb();
    const start = vi.fn().mockResolvedValue("https://storage.googleapis.com/upload/session");
    await initiateResourceUpload("actor-1", command, "https://menareps.example", { db, bucket: "bucket", gateway: { start, get: vi.fn(), delete: vi.fn() } });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ origin: "https://menareps.example", bucket: "bucket", mimeType: "application/pdf" }));

    const denied = authorizedDb("Finance Officer", true);
    const deniedStart = vi.fn();
    await expect(initiateResourceUpload("actor-2", command, "https://menareps.example", { db: denied.db, bucket: "bucket", gateway: { start: deniedStart, get: vi.fn(), delete: vi.fn() } }))
      .rejects.toMatchObject({ code: "RESOURCE_ROLE_DENIED", status: 403 });
    expect(deniedStart).not.toHaveBeenCalled();
  });

  it("includes the exact origin in Google Storage session initiation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200, headers: { location: "https://storage.googleapis.com/upload/session" } }));
    await googleStorageGateway.start({ bucket: "bucket", objectPath: "resources/PG-1/RES-1/v1/study.pdf", mimeType: "application/pdf", size: 1024, origin: "https://menareps.example" });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("uploadType=resumable"), expect.objectContaining({ headers: expect.objectContaining({ Origin: "https://menareps.example" }) }));
  });
});

const catalog = [
  { id: "A", active: true, promotionGroupId: "PG-A" },
  { id: "B", active: true, promotionGroupId: "PG-A" },
  { id: "X", active: true, promotionGroupId: "PG-X" },
];
const selected = (productIds: string[], promotionGroupId = "PG-A") => ({ ...command, promotionGroupId, productIds, metadata: { ...command.metadata } });
const groupWide = { ...command, promotionGroupId: "PG-A", productIds: [], resourceScope: "PROMOTION_GROUP" as const, metadata: { ...command.metadata, resourceScope: "PROMOTION_GROUP" } };
const assignment = (productId: string, extra: Record<string, unknown> = {}) => ({ assignmentId: `PA-${productId}`, userId: "PM", productId, productGroupId: catalog.find(product => product.id === productId)?.promotionGroupId, status: "Active", active: true, ...extra });

function scopeRepository(role: string, assignments: any[], products = catalog) {
  const actor = { id: role === "Product Manager" ? "PM" : "MM", role, active: true, loginAllowed: true };
  return {
    hierarchy: {
      async getUser(uid: string) { return uid === actor.id ? actor : role === "Marketing Manager" && uid === "REP" ? { id: "REP", role: "Marketing Officer", managerId: "MM", active: true } : null; },
      async getDirectReports(uid: string) { return role === "Marketing Manager" && uid === "MM" ? [{ id: "REP", role: "Marketing Officer", managerId: "MM", active: true }] : []; },
      async getAllUsers() { return [actor]; },
      async getRolePermissions() { return { viewTeamData: true }; },
    },
    async getGeographyCatalog() { return { countries: [{ id: "C" }], districts: [{ id: "D", countryId: "C" }], cities: [{ id: "CT", countryId: "C", districtId: "D" }], areas: [{ id: "AR", countryId: "C", districtId: "D", cityId: "CT" }], nodes: [{ countryId: "C", regionId: "D", districtId: "D", cityId: "CT", areaId: "AR", active: true }] }; },
    async getTerritoryAssignments() { return role === "Marketing Manager" ? [{ assignmentId: "TA", userId: "REP", status: "Active", active: true, countryId: "C", regionId: "D", districtId: "D", cityId: "CT", areaId: "AR" }] : []; },
    async getProductAssignments() { return assignments; },
    async getProducts() { return products as any; },
  } as any;
}

function authorizationDb(role: string, products = catalog, existing?: any) {
  const create = vi.fn().mockResolvedValue(undefined);
  const productDocs = products.map(product => ({ id: product.id, exists: true, data: () => product }));
  return {
    create,
    db: {
      collection(name: string) {
        return {
          doc(id: string) {
            if (name === "users") return { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role, active: true, loginAllowed: true, assignedProducts: ["B"], primaryPromotionGroupId: "PG-A", targetPromotionGroupIds: ["PG-X"] }) }) };
            if (name === "rolePermissions") return { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ resourceCapabilities: { manage: true } }) }) };
            if (name === "products") { const product = products.find(item => item.id === id); return { id, get: vi.fn().mockResolvedValue({ id, exists: Boolean(product), data: () => product }) }; }
            if (name === "academicResources") return { get: vi.fn().mockResolvedValue({ exists: Boolean(existing), data: () => existing }) };
            if (name === "resourceUploadAuthorizations") return { create };
            throw new Error(`Unexpected collection ${name}`);
          },
          where() { return { get: vi.fn().mockResolvedValue({ docs: productDocs.filter(item => item.data().promotionGroupId === "PG-A") }) }; },
        };
      },
    } as any,
  };
}

describe("Fix 3A Product Manager Resource authoring scope", () => {
  const now = () => new Date("2026-08-28T12:00:00.000Z");
  const authorize = (role: string, value: any, assignments: any[], products = catalog) => {
    const { db } = authorizationDb(role, products);
    return authorizeResourceUpload(role === "Product Manager" ? "PM" : role === "Marketing Manager" ? "MM" : "ADMIN", value, { db, scopeRepository: scopeRepository(role, assignments, products), now });
  };

  it("allows PM A and PM A+B without territory assignments", async () => {
    await expect(authorize("Product Manager", selected(["A"]), [assignment("A")])).resolves.toMatchObject({ productIds: ["A"] });
    await expect(authorize("Product Manager", selected(["A", "B"]), [assignment("A"), assignment("B")])).resolves.toMatchObject({ productIds: ["A", "B"] });
  });
  it("does not let same-group A authorize B", async () => {
    await expect(authorize("Product Manager", selected(["B"]), [assignment("A")])).rejects.toMatchObject({ code: "RESOURCE_PRODUCT_SCOPE_DENIED" });
  });
  it("rejects cross-Promotion-Group Products", async () => {
    await expect(authorize("Product Manager", selected(["X"], "PG-A"), [assignment("X")])).rejects.toMatchObject({ code: "RESOURCE_PRODUCT_INVALID" });
  });
  it.each([
    [[], "missing"],
    [[assignment("A", { active: false })], "inactive"],
    [[assignment("A", { effectiveFrom: "2026-08-29" })], "future"],
    [[assignment("A", { effectiveTo: "2026-08-27" })], "expired"],
  ])("rejects %s Product assignment scope", async (assignments) => {
    await expect(authorize("Product Manager", selected(["A"]), assignments as any[])).rejects.toMatchObject({ code: "RESOURCE_PRODUCT_SCOPE_DENIED" });
  });
  it("ignores profile Product and Promotion Group fields", async () => {
    await expect(authorize("Product Manager", selected(["B"]), [])).rejects.toMatchObject({ code: "RESOURCE_PRODUCT_SCOPE_DENIED" });
  });
  it("denies PM group-wide scope even when every Product is assigned", async () => {
    await expect(authorize("Product Manager", groupWide, [assignment("A"), assignment("B")])).rejects.toMatchObject({ code: "RESOURCE_PROMOTION_GROUP_OWNERSHIP_REQUIRED", status: 403 });
  });
  it.each(["Admin", "Super Admin"])("preserves %s group-wide authority", async role => {
    await expect(authorize(role, groupWide, [])).resolves.toMatchObject({ productIds: [] });
  });
  it("preserves Marketing Manager hierarchy-derived operational scope", async () => {
    await expect(authorize("Marketing Manager", selected(["A"]), [{ ...assignment("A"), userId: "REP" }])).resolves.toMatchObject({ productIds: ["A"] });
  });
  it("does not grant Medical Representative management authority", async () => {
    const { db } = authorizationDb("Medical Representative");
    await expect(authorizeResourceUpload("REP", selected(["A"]), { db, scopeRepository: scopeRepository("Medical Representative", [assignment("A")]), now })).rejects.toMatchObject({ code: "RESOURCE_ROLE_DENIED" });
  });
  it("rejects empty selected scope", async () => {
    await expect(authorize("Product Manager", selected([]), [])).rejects.toMatchObject({ code: "RESOURCE_SELECTED_PRODUCTS_REQUIRED" });
  });
  it("keeps selected Product-set replacement immutable", async () => {
    const existing = { resourceScope: "SELECTED_PRODUCTS", promotionGroupId: "PG-A", productIds: ["A"], fileVersion: 1 };
    const { db } = authorizationDb("Admin", catalog, existing);
    await expect(initiateResourceUpload("ADMIN", { ...selected(["A", "B"]), replaceResourceId: "RES-1" }, "https://example.test", { db, bucket: "bucket", gateway: { start: vi.fn(), get: vi.fn(), delete: vi.fn() } })).rejects.toMatchObject({ code: "RESOURCE_REPLACEMENT_SCOPE_IMMUTABLE" });
  });
  it("allows a legacy group snapshot replacement after Product membership changes and persists an empty scope", async () => {
    const existing = { resourceScope: "PROMOTION_GROUP", promotionGroupId: "PG-A", productIds: ["A"], fileVersion: 1 };
    const { db, create } = authorizationDb("Admin", catalog, existing);
    const start = vi.fn().mockResolvedValue("https://storage.example/session");
    await initiateResourceUpload("ADMIN", { ...groupWide, replaceResourceId: "RES-1" }, "https://example.test", { db, bucket: "bucket", gateway: { start, get: vi.fn(), delete: vi.fn() } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ resourceScope: "PROMOTION_GROUP", productIds: [] }));
  });

  it("reauthorizes current PM Product assignments during finalization", async () => {
    let assignments = [assignment("A")];
    const auth = { actorUid: "PM", role: "Product Manager", resourceId: "RES-1", replacing: false, promotionGroupId: "PG-A", resourceScope: "SELECTED_PRODUCTS", productIds: ["A"], bucket: "bucket", objectPath: "resources/PG-A/RES-1/v1/a.pdf", originalFileName: "a.pdf", sanitizedFileName: "a.pdf", expectedMimeType: "application/pdf", expectedSize: 10, version: 1, metadata: { resourceScope: "SELECTED_PRODUCTS", approvalStatus: "PUBLISHED" }, status: "PENDING", expiresAt: "2026-08-29T00:00:00.000Z" };
    const transactionCreate = vi.fn();
    const authRef = { get: vi.fn().mockResolvedValue({ exists: true, data: () => auth }), set: vi.fn() };
    const db = {
      collection(name: string) {
        return {
          doc(id: string) {
            if (name === "users") return { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: "Product Manager", active: true, loginAllowed: true }) }) };
            if (name === "rolePermissions") return { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ resourceCapabilities: { manage: true } }) }) };
            if (name === "products") { const product = catalog.find(item => item.id === id); return { id, get: vi.fn().mockResolvedValue({ id, exists: Boolean(product), data: () => product }) }; }
            if (name === "resourceUploadAuthorizations") return authRef;
            if (name === "academicResources") return { id };
            throw new Error(name);
          },
        };
      },
      async runTransaction(callback: any) { return callback({ get: vi.fn().mockResolvedValue({ data: () => auth }), create: transactionCreate, set: vi.fn(), update: vi.fn() }); },
    } as any;
    const repository = scopeRepository("Product Manager", assignments);
    repository.getProductAssignments = async () => assignments;
    const deps = { db, scopeRepository: repository, now, gateway: { start: vi.fn(), get: vi.fn().mockResolvedValue({ size: 10, contentType: "application/pdf", generation: "1" }), delete: vi.fn() } };
    await expect(finalizeResourceUpload("PM", "AUTH-1", deps)).resolves.toMatchObject({ success: true });
    expect(transactionCreate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ productIds: ["A"] }));
    assignments = [];
    await expect(finalizeResourceUpload("PM", "AUTH-1", deps)).rejects.toMatchObject({ code: "RESOURCE_PRODUCT_SCOPE_DENIED" });
  });

  it("normalizes a touched legacy group-wide resource to an empty Product list", async () => {
    const existing = { resourceScope: "PROMOTION_GROUP", promotionGroupId: "PG-A", productIds: ["A"], originalFileName: "a.pdf", mimeType: "application/pdf", fileSizeBytes: 10 };
    const set = vi.fn();
    const db = {
      collection(name: string) {
        return {
          doc(id: string) {
            if (name === "users") return { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ role: "Admin", active: true, loginAllowed: true }) }) };
            if (name === "rolePermissions") return { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ resourceCapabilities: { manage: true } }) }) };
            if (name === "products") { const product = catalog.find(item => item.id === id); return { id, get: vi.fn().mockResolvedValue({ id, exists: Boolean(product), data: () => product }) }; }
            if (name === "academicResources") return { get: vi.fn().mockResolvedValue({ exists: true, data: () => existing }), set };
            throw new Error(name);
          },
          where() { return { get: vi.fn().mockResolvedValue({ docs: catalog.filter(item => item.promotionGroupId === "PG-A").map(item => ({ id: item.id, exists: true, data: () => item })) }) }; },
        };
      },
    } as any;
    await mutateResourceMetadata("ADMIN", { resourceId: "RES-1", patch: { titleEn: "Updated" } }, { db, now });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ productIds: [] }), { merge: true });
  });
});
