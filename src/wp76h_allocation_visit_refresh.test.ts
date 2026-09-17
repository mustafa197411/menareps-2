import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Role, type SampleAllocation, type User } from "./types";
import { filterSampleAllocationsByAuthorizedRepIds } from "./lib/sampleAuthorization";
import { resolveSampleAllocationDisplay } from "./lib/sampleAllocationDisplay";
import {
  refreshScopedPhysicianVisitHistory,
  type PhysicianVisitReadController,
  type PhysicianVisitReadState,
} from "./lib/physicianVisitReadClient";

const rep = { id: "es6CqQrsLjUqSO8HSc6MS23PWY13", role: Role.MEDICAL_REP } as User;
const allocation: SampleAllocation = {
  id: "AL-257644-1",
  repId: rep.id,
  sampleSkuId: "S399",
  productId: "PROD-2551",
  batchId: "S399-MK120",
  quantityAllocated: 20,
  quantityDistributed: 1,
  quantityRemaining: 19,
  allocatedAt: "2026-08-14T00:03:16.762Z",
  allocatedBy: "allocator",
  status: "ACTIVE",
  reportingMonth: "2026-08",
  createdAt: "2026-08-14T00:03:16.762Z",
  createdBy: "allocator",
};

describe("WP76H allocation visibility and visit history refresh", () => {
  it("keeps a representative-owned allocation visible without secondary territory hydration", () => {
    expect(filterSampleAllocationsByAuthorizedRepIds([allocation], [rep.id], "OWN")).toEqual([allocation]);
  });

  it("represents the certified allocation quantities without legacy-field drift", () => {
    const row = resolveSampleAllocationDisplay(allocation, [rep], [], []);
    expect(row).toMatchObject({ allocatedQuantity: 20, distributedQuantity: 1, remainingQuantity: 19 });
  });

  it("does not broaden allocation access beyond authorized representative UIDs", () => {
    const other = { ...allocation, id: "AL-OTHER", repId: "another-representative" };
    expect(filterSampleAllocationsByAuthorizedRepIds([allocation, other], [rep.id], "OWN")).toEqual([allocation]);
  });

  it("reloads the scoped controller and returns the newly completed visit", async () => {
    const completedVisit = {
      id: "DRAFT-VIS-PHY-504-1786677348275",
      repId: rep.id,
      physicianId: "PHY-504",
      visitDate: "2026-08-14",
      status: "Completed",
      detailing: [],
      samples: [],
    } as any;
    let state: PhysicianVisitReadState = { status: "READY", actorUid: rep.id, visits: [] };
    const controller: PhysicianVisitReadController = {
      getState: () => state,
      subscribe: vi.fn(() => () => undefined),
      load: vi.fn(async actorUid => { state = { status: "READY", actorUid, visits: [completedVisit] }; }),
      clear: vi.fn(),
    };

    const visits = await refreshScopedPhysicianVisitHistory(controller, rep.id, { getIdToken: vi.fn() } as any);

    expect(controller.load).toHaveBeenCalledOnce();
    expect(visits).toEqual([completedVisit]);
  });

  it("wires confirmed completion to history refresh without another persistence call", () => {
    const app = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const completion = app.slice(app.indexOf("const handleCompletePhysicianVisit"), app.indexOf("const handleCompletePharmacyVisit"));
    expect(completion).toContain('result.status === "COMPLETED"');
    expect(completion).toContain("refreshScopedPhysicianVisitHistory");
    expect(completion.match(/savePhysicianVisitRecord\(/g)).toHaveLength(1);
  });

  it("uses injected build identity metadata and contains no stale WP75D identity", () => {
    const main = fs.readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
    expect(main).toContain("VITE_GIT_COMMIT");
    expect(main).toContain("MENAREPS_BUILD_RUNTIME_IDENTITY_MISMATCH");
    expect(main).toContain("VITE_CLOUD_RUN_REVISION");
    expect(main).not.toContain("wp75d-stable");
    expect(main).not.toContain("menareps-2.0-rev");
  });
});
