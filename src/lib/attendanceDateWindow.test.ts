import { describe, expect, it } from "vitest";
import { findCurrentAttendanceSession, resolveAttendanceDateWindow } from "./attendanceDateWindow";
import type { AttendanceSession } from "./attendanceEngine";

const session = (date: string): AttendanceSession => ({
  id: `REP:${date}`, userId: "REP", marketId: "MARKET", countryId: "COUNTRY", date, timezone: "Africa/Tripoli",
  scheduledStart: `${date}T06:00:00Z`, scheduledEnd: `${date}T14:00:00Z`, actualCheckIn: `${date}T06:01:00Z`, status: "OPEN",
  createdBy: "REP", createdAt: `${date}T06:01:00Z`, updatedBy: "REP", updatedAt: `${date}T06:01:00Z`,
});

describe("WP93 canonical market-time attendance window", () => {
  it("uses the Africa/Tripoli business date near the preceding UTC midnight boundary", () => expect(resolveAttendanceDateWindow("2026-08-20T22:30:00Z", "Africa/Tripoli")).toMatchObject({ currentDate: "2026-08-21", monthStart: "2026-08-01" }));
  it("keeps ordinary daytime behavior unchanged", () => expect(resolveAttendanceDateWindow("2026-08-21T12:00:00Z", "Africa/Tripoli").currentDate).toBe("2026-08-21"));
  it("includes the canonical current market date in the scoped-query window", () => { const window = resolveAttendanceDateWindow("2026-08-20T22:30:00Z", "Africa/Tripoli"); expect(window.monthStart <= window.currentDate).toBe(true); expect(window.currentDate).toBe("2026-08-21"); });
  it("rehydrates only the persisted current-day session for the actor and market", () => { const current = session("2026-08-21"); expect(findCurrentAttendanceSession([session("2026-08-20"), current], "REP", "MARKET", "2026-08-21")).toEqual(current); expect(findCurrentAttendanceSession([current], "OTHER", "MARKET", "2026-08-21")).toBeUndefined(); });
});
