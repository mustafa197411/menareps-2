import { describe, expect, it, vi } from "vitest";
import { fetchScopedPhysicianVisitHistory, fetchScopedPhysicianVisitSummaries } from "./physicianVisitHistoryClient";

const user = { getIdToken: vi.fn(async () => "verified-token") };

function responseFor(body: string): Response {
  const input = JSON.parse(body) as { physicianIds: string[]; includeHistory: boolean };
  return new Response(JSON.stringify({
    authorized: true,
    scopeMode: "SELF",
    summaries: input.physicianIds.map((physicianId) => ({
      physicianId,
      scopeMode: "SELF",
      subjectUids: ["REP_A"],
      lastVisit: null,
      totalCompletedVisits: 0,
      currentMonthCompletedVisits: 0,
      ...(input.includeHistory ? { visits: [] } : {}),
    })),
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("Fix 5B.1 scoped physician history client", () => {
  it("chunks every physician summary request without truncating the directory", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => responseFor(String(init?.body)));
    const ids = Array.from({ length: 205 }, (_, index) => `PHY_${index}`);
    const summaries = await fetchScopedPhysicianVisitSummaries(user, ids, fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(summaries.size).toBe(205);
  });

  it("uses only a Firebase token and canonical physician/subject fields", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => responseFor(String(init?.body)));
    await fetchScopedPhysicianVisitHistory(user, "PHY_1", "REP_A", fetcher as typeof fetch);
    const init = fetcher.mock.calls[0][1];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer verified-token" });
    expect(JSON.parse(String(init?.body))).toEqual({ physicianIds: ["PHY_1"], includeHistory: true, subjectUid: "REP_A" });
  });

  it("returns the same persisted scoped result after a new client call (hard-refresh contract)", async () => {
    const persistedVisit = { id: "V_1", physicianId: "PHY_1", physicianName: "Physician", repId: "REP_A", repName: "REP_A", status: "Completed", visitDate: "2025-01-01", durationSeconds: 60, detailing: [], samples: [], additionalSampleRequests: [], generalNotes: "", gpsVerified: true };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ authorized: true, scopeMode: "SELF", summaries: [{ physicianId: "PHY_1", scopeMode: "SELF", subjectUids: ["REP_A"], lastVisit: persistedVisit, totalCompletedVisits: 1, currentMonthCompletedVisits: 0, visits: [persistedVisit] }] }), { status: 200 }));
    const first = await fetchScopedPhysicianVisitHistory(user, "PHY_1", undefined, fetcher as typeof fetch);
    const refreshed = await fetchScopedPhysicianVisitHistory(user, "PHY_1", undefined, fetcher as typeof fetch);
    expect(refreshed).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
