import { describe, expect, it, vi } from "vitest";
import { fetchDashboardPhysicianVisits } from "./dashboardVisitDataClient";
import type { PhysicianVisit } from "../types";

describe("dashboard bounded scoped visit pagination", () => {
  it("loads every cursor page inside the selected operational period", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce({ authorized: true, visits: [{ id: "2", visitDate: "2026-08-28" } as PhysicianVisit], nextCursor: "next" })
      .mockResolvedValueOnce({ authorized: true, visits: [{ id: "1", visitDate: "2026-08-27" } as PhysicianVisit] });
    const result = await fetchDashboardPhysicianVisits({ getIdToken: vi.fn() } as any, { filter: "this-week", fromDate: "2026-08-24", toDate: "2026-08-28" }, loader);
    expect(result.map((item) => item.id)).toEqual(["2", "1"]);
    expect(loader).toHaveBeenNthCalledWith(1, expect.anything(), { fromDate: "2026-08-24", toDate: "2026-08-28", pageSize: 100 });
    expect(loader).toHaveBeenNthCalledWith(2, expect.anything(), { fromDate: "2026-08-24", toDate: "2026-08-28", pageSize: 100, cursor: "next" });
  });
});
