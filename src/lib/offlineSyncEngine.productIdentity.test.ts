import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  saveProduct: vi.fn(), registerOfflineFallbackHandler: vi.fn(),
  isRetryableProductPersistenceError: vi.fn((error: any) => error?.retryable === true),
  savePhysicianVisitRecord: vi.fn(), savePharmacyVisitRecord: vi.fn(), saveOrder: vi.fn(), savePlannerApprovalTransactional: vi.fn(),
  disburseSampleTransactional: vi.fn(), receiveSampleStockTransactional: vi.fn(), adjustSampleStockTransactional: vi.fn(), saveAuditLogRecord: vi.fn(),
}));
const firestoreMocks = vi.hoisted(() => ({ setDoc: vi.fn() }));
const storage = new Map<string, string>();

vi.mock("./firestoreService", () => serviceMocks);
vi.mock("./firebase", () => ({ auth: { currentUser: { uid: "ACTOR_OFFLINE" } }, db: {}, firestoreDatabaseId: "test-database" }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), setDoc: firestoreMocks.setDoc, query: vi.fn(), where: vi.fn(), runTransaction: vi.fn(), disableNetwork: vi.fn(), enableNetwork: vi.fn(),
}));
vi.mock("./firebaseSync", () => ({ decorateRecord: vi.fn((value: unknown) => value) }));
vi.mock("./samplePersistence", () => ({ prepareSampleWrite: vi.fn() }));
vi.mock("./firebaseError", () => ({ clearFirestoreError: vi.fn() }));

let executeOfflineAction: typeof import("./offlineSyncEngine").executeOfflineAction;
let isTerminalOfflineProductFailure: typeof import("./offlineSyncEngine").isTerminalOfflineProductFailure;
let triggerAutomaticSync: typeof import("./offlineSyncEngine").triggerAutomaticSync;

beforeAll(async () => {
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: vi.fn((key: string) => storage.get(key) || null), setItem: vi.fn((key: string, value: string) => storage.set(key, value)) });
  ({ executeOfflineAction, isTerminalOfflineProductFailure, triggerAutomaticSync } = await import("./offlineSyncEngine"));
});

beforeEach(() => { vi.clearAllMocks(); storage.clear(); });

const item = (action: "create" | "update") => ({
  id: "QUEUE_PRODUCT", module: "products" as const, action, data: { id: "PRODUCT_OFFLINE", name: "Synthetic", isActive: true },
  status: "pending" as const, retryCount: 0, createdAt: "2035-01-01T00:00:00.000Z", updatedAt: "2035-01-01T00:00:00.000Z", userId: "ACTOR_OFFLINE",
});

describe("offline Product persistence", () => {
  it.each([["create", "create"], ["update", "edit"]] as const)("replays %s through the authenticated backend as %s", async (action, operation) => {
    serviceMocks.saveProduct.mockResolvedValue({ id: "PRODUCT_OFFLINE" });
    await executeOfflineAction(item(action));
    expect(serviceMocks.saveProduct).toHaveBeenCalledWith(item(action).data, "ACTOR_OFFLINE", operation);
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });

  it("propagates authentication or authorization rejection with zero direct Product writes", async () => {
    serviceMocks.saveProduct.mockRejectedValue(new Error("PRODUCT_AUTHENTICATION_REQUIRED"));
    await expect(executeOfflineAction(item("create"))).rejects.toThrow("PRODUCT_AUTHENTICATION_REQUIRED");
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
  });

  it("classifies stable Product replay rejection as terminal and connectivity failure as retryable", () => {
    expect(isTerminalOfflineProductFailure("products", { status: 409, retryable: false })).toBe(true);
    expect(isTerminalOfflineProductFailure("products", { status: 0, retryable: true })).toBe(false);
    expect(isTerminalOfflineProductFailure("order", { status: 409, retryable: false })).toBe(false);
  });

  it("moves stable replay rejection directly to failed while retaining connectivity failure for retry", async () => {
    storage.set("menareps_offline_queue_pending", JSON.stringify([item("create")]));
    serviceMocks.saveProduct.mockRejectedValueOnce({ code: "PRODUCT_CREATE_CONFLICT", status: 409, retryable: false });
    await triggerAutomaticSync();
    expect(JSON.parse(storage.get("menareps_offline_queue_failed") || "[]")).toHaveLength(1);
    expect(JSON.parse(storage.get("menareps_offline_queue_retry") || "[]")).toHaveLength(0);

    storage.clear();
    storage.set("menareps_offline_queue_pending", JSON.stringify([item("create")]));
    serviceMocks.saveProduct.mockRejectedValueOnce({ code: "PRODUCT_NETWORK_UNAVAILABLE", status: 0, retryable: true });
    await triggerAutomaticSync();
    expect(JSON.parse(storage.get("menareps_offline_queue_failed") || "[]")).toHaveLength(0);
    expect(JSON.parse(storage.get("menareps_offline_queue_retry") || "[]")).toHaveLength(1);
  });
});
