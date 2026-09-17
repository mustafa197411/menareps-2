import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Physician } from "../types";
import {
  createPhysicianReadController,
  fetchScopedPhysicians,
} from "./physicianReadClient";

const physician = (id: string): Physician => ({
  id,
  name: id,
  specialty: "GP",
  classification: "A",
  territory: "A1",
  region: "R1",
  address: "Clinic",
  areaId: "A1",
  alignedProductIds: ["P1"],
});

const tokenProvider = { getIdToken: vi.fn(async () => "SECRET") };

afterEach(() => vi.restoreAllMocks());

describe("WP5.2F.3 physician READ client and migration boundary", () => {
  it("14. frontend network failure clears physician data", async () => {
    const controller = createPhysicianReadController(async () => { throw new Error("offline"); });
    await controller.load("UID1", tokenProvider);
    expect(controller.getState()).toEqual({ status: "ERROR", actorUid: "UID1", physicians: [] });
  });

  it("15. UID transition clears previous physician data before the new request resolves", async () => {
    let resolveSecond!: (value: { authorized: boolean; physicians: Physician[] }) => void;
    const second = new Promise<{ authorized: boolean; physicians: Physician[] }>((resolve) => { resolveSecond = resolve; });
    const loader = vi.fn()
      .mockResolvedValueOnce({ authorized: true, physicians: [physician("OLD")] })
      .mockReturnValueOnce(second);
    const controller = createPhysicianReadController(loader);
    await controller.load("UID1", tokenProvider);
    const pending = controller.load("UID2", tokenProvider);
    expect(controller.getState()).toEqual({ status: "LOADING", actorUid: "UID2", physicians: [] });
    resolveSecond({ authorized: true, physicians: [physician("NEW")] });
    await pending;
    expect(controller.getState().physicians.map((item) => item.id)).toEqual(["NEW"]);
  });

  it("16. malformed response fails closed with no legacy fallback", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authorized: true }), { status: 200 }));
    const controller = createPhysicianReadController((user) => fetchScopedPhysicians(user, fetchMock));
    await controller.load("UID1", tokenProvider);
    expect(controller.getState()).toEqual({ status: "ERROR", actorUid: "UID1", physicians: [] });
    const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).not.toContain("SAFE LISTENER STARTED: physicians");
    expect(app).toContain("createPhysicianReadController");
  });

  it("17. PhysicianList no longer uses legacy eligibility as directory READ authority", () => {
    const source = fs.readFileSync(new URL("../components/PhysicianList.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("isPhysicianEligibleForUser");
    expect(source).toContain("return finalRecords;");
  });

  it("18. physician visit execution eligibility remains unchanged", () => {
    const source = fs.readFileSync(new URL("../components/PhysicianVisit.tsx", import.meta.url), "utf8");
    expect(source).toContain("isPhysicianEligibleForUser");
  });

  it("19. directory migration does not broaden Add/Edit/Visit/Detail/Sample permissions", () => {
    const app = fs.readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const visit = fs.readFileSync(new URL("../components/PhysicianVisit.tsx", import.meta.url), "utf8");
    const samples = fs.readFileSync(new URL("./sampleAuthorization.ts", import.meta.url), "utf8");
    expect(app).toContain("onAddPhysician={handleAddPhysician}");
    expect(app).toContain("onUpdatePhysician={handleUpdatePhysician}");
    expect(visit).toContain("isPhysicianEligibleForUser");
    expect(samples).toContain("DISTRIBUTE_SAMPLE");
    expect(app).not.toContain("operationalScopeSession.scope?.role");
  });

  it("20. backend implementation contains only bounded physician area queries", () => {
    const source = fs.readFileSync(new URL("../../server/physicianReadService.ts", import.meta.url), "utf8");
    expect(source).toContain('.where("areaId", "in", canonicalAreaIds)');
    expect(source).not.toMatch(/collection\("physicians"\)\s*\.get\s*\(/);
  });
});
