import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCanonicalOperationalScope,
  type CanonicalOperationalScope,
} from "./operationalScopeClient";
import { createOperationalScopeSessionController } from "./operationalScopeSession";

const boundedScope = (overrides: Partial<CanonicalOperationalScope> = {}): CanonicalOperationalScope => ({
  authorized: true,
  actorUid: "UID-1",
  role: "Product Manager",
  boundaryKind: "AREA",
  subjectMode: "HIERARCHY",
  subjectUids: ["UID-1"],
  authorizedRepresentativeUids: [],
  countryIds: ["C1"],
  regionIds: ["R1"],
  districtIds: ["R1"],
  cityIds: ["CT1"],
  areaIds: ["A1"],
  productIds: ["P1"],
  productGroupIds: [],
  queryPlan: {
    denyAll: false,
    areaIdChunks: [["A1"]],
    subjectUidChunks: [["UID-1"]],
    productIdChunks: [["P1"]],
    requiresPostFilter: false,
  },
  diagnostics: {
    excludedAssignmentIds: [],
    malformedAssignmentIds: [],
    outsideBoundaryAssignmentIds: [],
  },
  ...overrides,
});

const tokenProvider = { getIdToken: vi.fn(async () => "SECRET-ID-TOKEN") };

afterEach(() => vi.restoreAllMocks());

describe("WP5.2F.1 operational scope bootstrap gate", () => {
  it("sets an authenticated active user with an authorized bounded response to READY", async () => {
    const controller = createOperationalScopeSessionController(async () => boundedScope());
    await controller.bootstrap("UID-1", tokenProvider);
    expect(controller.getState()).toEqual({ status: "READY", actorUid: "UID-1", scope: boundedScope() });
  });

  it("sets authorized=false to DENIED without retaining scope", async () => {
    const controller = createOperationalScopeSessionController(async () => boundedScope({ authorized: false }));
    await controller.bootstrap("UID-1", tokenProvider);
    expect(controller.getState()).toEqual({ status: "DENIED", actorUid: "UID-1", scope: null });
  });

  it("sets queryPlan.denyAll=true to DENIED", async () => {
    const denied = boundedScope({ queryPlan: { ...boundedScope().queryPlan, denyAll: true } });
    const controller = createOperationalScopeSessionController(async () => denied);
    await controller.bootstrap("UID-1", tokenProvider);
    expect(controller.getState().status).toBe("DENIED");
  });

  it("sets endpoint or network failure to ERROR", async () => {
    const controller = createOperationalScopeSessionController(async () => {
      throw new Error("network unavailable");
    });
    await controller.bootstrap("UID-1", tokenProvider);
    expect(controller.getState()).toEqual({ status: "ERROR", actorUid: "UID-1", scope: null });
  });

  it("rejects a malformed endpoint response and produces ERROR", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authorized: true }), { status: 200 }));
    const controller = createOperationalScopeSessionController((user) => fetchCanonicalOperationalScope(user, fetchMock));
    await controller.bootstrap("UID-1", tokenProvider);
    expect(controller.getState().status).toBe("ERROR");
  });

  it("clears canonical scope on logout", async () => {
    const controller = createOperationalScopeSessionController(async () => boundedScope());
    await controller.bootstrap("UID-1", tokenProvider);
    controller.clear();
    expect(controller.getState()).toEqual({ status: "UNINITIALIZED", actorUid: null, scope: null });
  });

  it("clears the previous UID scope before resolving a new UID", async () => {
    let resolveSecond!: (scope: CanonicalOperationalScope) => void;
    const second = new Promise<CanonicalOperationalScope>((resolve) => { resolveSecond = resolve; });
    const loader = vi.fn()
      .mockResolvedValueOnce(boundedScope())
      .mockReturnValueOnce(second);
    const controller = createOperationalScopeSessionController(loader);
    await controller.bootstrap("UID-1", tokenProvider);

    const pending = controller.bootstrap("UID-2", tokenProvider);
    expect(controller.getState()).toEqual({ status: "LOADING", actorUid: "UID-2", scope: null });
    resolveSecond(boundedScope({ actorUid: "UID-2", subjectUids: ["UID-2"] }));
    await pending;
    expect(controller.getState().actorUid).toBe("UID-2");
  });

  it("sends the ID token only in the Authorization header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(boundedScope()), { status: 200 }));
    await fetchCanonicalOperationalScope(tokenProvider, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/operational-scope", {
      method: "POST",
      headers: { Authorization: "Bearer SECRET-ID-TOKEN", "Content-Type": "application/json" },
      body: "{}",
    });
  });

  it("does not log or persist the token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(boundedScope()), { status: 200 }));
    await fetchCanonicalOperationalScope(tokenProvider, fetchMock);
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("provides no permissive legacy fallback after canonical denial or error", async () => {
    const denial = createOperationalScopeSessionController(async () => boundedScope({ authorized: false }));
    const failure = createOperationalScopeSessionController(async () => { throw new Error("failed"); });
    await denial.bootstrap("UID-1", tokenProvider);
    await failure.bootstrap("UID-1", tokenProvider);
    expect(denial.getState().scope).toBeNull();
    expect(failure.getState().scope).toBeNull();
    expect([denial.getState().status, failure.getState().status]).toEqual(["DENIED", "ERROR"]);
  });

  it("leaves existing business-data listeners on legacy paths in WP5.2F.1", () => {
    const appSource = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(appSource).toContain('listenCollection<UserTerritoryAssignment>("userTerritoryAssignments"');
    expect(appSource).toContain('listenCollection<UserProductAssignment>("userProductAssignments"');
    expect(appSource).toContain('collection(db, "physicians")');
    expect(appSource).toContain('collection(db, "pharmacies")');
    expect(appSource).not.toContain("operationalScopeSession.scope?.areaIds");
  });
});
