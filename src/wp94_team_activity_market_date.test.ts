import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveAttendanceDateWindow } from "./lib/attendanceDateWindow";

const teamActivity = fs.readFileSync(new URL("./components/supervision/TeamActivity.tsx", import.meta.url), "utf8");
const teamService = fs.readFileSync(new URL("../server/teamActivityReadService.ts", import.meta.url), "utf8");

describe("WP94 canonical Team Activity market date", () => {
  it("uses the Africa/Tripoli current business date at the preceding UTC boundary", () => expect(resolveAttendanceDateWindow("2026-08-20T22:30:00Z", "Africa/Tripoli").currentDate).toBe("2026-08-21"));
  it("keeps ordinary daytime date behavior unchanged", () => expect(resolveAttendanceDateWindow("2026-08-21T12:00:00Z", "Africa/Tripoli").currentDate).toBe("2026-08-21"));
  it("uses the shared market-date authority for the exact current-day manager query", () => {
    expect(teamActivity).toContain("resolveAttendanceDateWindow(new Date(), market.timezone).currentDate");
    expect(teamActivity).toContain("fetchScopedTeamActivity(auth.currentUser, today, today)");
    expect(teamActivity).not.toContain("new Date().toISOString().slice(0, 10)");
  });
  it("preserves backend canonical subject filtering and does not move calendar policy into Team Activity", () => {
    expect(teamService).toContain("resolveOperationalScopeForActor");
    expect(teamService).toContain("allowed.has(row.userId)");
    expect(teamActivity).not.toContain("resolveBusinessCalendarDay");
  });
});
